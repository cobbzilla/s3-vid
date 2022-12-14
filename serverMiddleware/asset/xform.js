import { spawn } from 'node:child_process'
import glob from 'glob'

const fs = require('fs')
const path = require('path')
const shellescape = require('shell-escape')
const nuxt = require('../../nuxt.config').default
const s3cfg = require('../s3/s3client.js')
const s3util = require('../s3/s3util')
const util = require('../util/file')
const redis = require('../util/redis')
const c = require('../../shared')
const m = require('../../shared/media')
const manifest = require('./manifest')
const q = require('./job')

const MAX_XFORM_ERRORS = 3

const SHOW_XFORM_OUTPUT = nuxt.privateRuntimeConfig.autoscan.showTransformOutput

const XFORM_PROCESS_FUNCTION = (job, done) => {
  ensureSourceDownloaded(job).then((file) => {
    if (file) {
      createArtifacts(job, file).then(() => done())
    }
  })
}

q.initializeQueue(XFORM_PROCESS_FUNCTION)

const MEDIA_COMMANDS = nuxt.privateRuntimeConfig.media
const ALWAYS_ALLOWED_COMMANDS = ['mediainfo']

function mediainfo (sourcePath, sourceFile, profile, outfile) {
  const args = []
  if (profile.details) {
    args.push('--Details=1')
  } else {
    args.push('--Output=JSON')
    if (profile.full) {
      args.push('--Full')
    }
  }
  args.push(sourceFile)
  return args
}

function profileCommand (profile) {
  return profile.command ? profile.command : MEDIA_COMMANDS[profile.mediaType].allowedCommands[0]
}

function looksLikeShellCommand (command) {
  return command.length <= 5 && command.endsWith('sh')
}

function isCommandAllowed (mediaType, command) {
  const allowedCommands = MEDIA_COMMANDS[mediaType].allowedCommands
  return !looksLikeShellCommand(command) &&
    (ALWAYS_ALLOWED_COMMANDS.includes(command) || (allowedCommands && allowedCommands.includes(command)))
}

function runTransformCommand (job, profile, outfile, args, closeHandler) {
  const mediaType = profile.mediaType
  const command = profileCommand(profile)
  const logPrefix = `runTransformCommand(command=${command}, profile=${profile.name}):`
  const jobPrefix = `${mediaType}_${profile.name}_runTransformCommand`

  // you can't just run any old command here sonny!
  if (!isCommandAllowed(mediaType, command)) {
    throw new TypeError(`${logPrefix}: profile command not allowed: ${command}`)
  }
  const saveStdout = (profile.outfile && profile.outfile === 'stdout')
  const saveStderr = (profile.outfile && profile.outfile === 'stderr')

  const escapedArgs = shellescape(args)
  q.recordJobEvent(job, `${jobPrefix}_spawn`, `${command} ${escapedArgs}`)
  const xform = spawn(command, args)
  const stream = (saveStdout || saveStderr) ? fs.createWriteStream(outfile) : null
  xform.stdout.on('data', (data) => {
    if (saveStdout) {
      stream.write(data, (err) => {
        if (err) {
          console.log(`${logPrefix} error writing stdout to ${outfile}: ${err}`)
          throw err
        }
      })
    } else if (SHOW_XFORM_OUTPUT) {
      console.log(`stdout >>>>>> ${data}`)
    }
  })

  xform.stderr.on('data', (data) => {
    if (saveStderr) {
      stream.write(data, (err) => {
        if (err) {
          console.log(`${logPrefix} error writing stderr to ${outfile}: ${err}`)
          throw err
        }
      })
    } else if (SHOW_XFORM_OUTPUT) {
      console.log(`stdout >>>>>> ${data}`)
    }
  })

  xform.on('close', (code) => {
    console.log(`${logPrefix}  exited with code ${code}`)
    q.recordJobEvent(job, `${jobPrefix}_spawn_END`, `${command}: exit code ${code}`)
    closeHandler(code)
  })
}

function multifilePrefix (outfile) {
  const placeholder = outfile.lastIndexOf(util.MULTIFILE_PLACEHOLDER)
  if (placeholder === -1) {
    const message = `multifilePrefix: expected to find placeholder (${util.MULTIFILE_PLACEHOLDER}) in outfile: ${outfile}`
    console.error(message)
    throw new TypeError(message)
  }
  return outfile.substring(0, placeholder)
}

function deleteLocalFiles (outfile, profile, job, jobPrefix) {
  if (profile.multiFile) {
    const outfilePrefix = multifilePrefix(outfile)
    glob(outfilePrefix + '*', (err, files) => {
      if (err) {
        console.error(`deleteLocalFiles: glob error: ${err}`)
        return
      }
      files.forEach((f) => {
        util.deleteFile(f)
      })
      q.recordJobEvent(job, `${jobPrefix}_deleted_local_files`, files.join('\n'))
    })
  } else {
    util.deleteFile(outfile)
    q.recordJobEvent(job, `${jobPrefix}_deleted_local_file`, outfile)
  }
}

async function clearErrors (job, jobPrefix, sourcePath, profile) {
  q.recordJobEvent(job, `${jobPrefix}_clearing_errors`)
  await s3util.clearErrors(sourcePath, profile.name)
  q.recordJobEvent(job, `${jobPrefix}_cleared_errors`)
}

async function uploadAsset (sourcePath, outfile, job, jobPrefix) {
  const outfileSize = util.statSize(outfile)
  const destKey = util.canonicalDestDir(sourcePath) + path.basename(outfile)
  const fileUp = fs.createReadStream(outfile)
  console.log(`uploadAsset(${destKey}): uploading asset ${outfile} to destKey=${destKey}`)
  q.recordJobEvent(job, `${jobPrefix}_start_uploading_asset`, destKey)
  if (await s3util.uploadObject({ Key: destKey, Body: fileUp }) == null) {
    const message = `uploadAsset(${destKey}): error uploading asset (upload failed)`
    console.error(message)
    q.recordJobEvent(job, `${jobPrefix}_ERROR_uploading_asset`, destKey)
    await s3util.deleteDestObject(destKey)
    return message
  } else {
    // ensure it was uploaded
    const head = await s3util.headDestObject(destKey)
    if (head && head.ContentLength && head.ContentLength === outfileSize) {
      // upload success!
      console.log(`uploadAsset(${destKey}): uploaded ${outfile} to destKey=${destKey}`)
      s3util.touchLastModified(sourcePath)
      await redis.del(util.redisMetaCacheKey(sourcePath))
      q.recordJobEvent(job, `${jobPrefix}_SUCCESS_uploading_asset`, destKey)
      return null
    } else {
      const message = `uploadAsset(${destKey}): error uploading asset (size mismatch): ${outfile} = ${outfileSize}, head=${JSON.stringify(head)}`
      console.error(message)
      q.recordJobEvent(job, `${jobPrefix}_ERROR_uploading_asset_size_mismatch`, message)
      await s3util.deleteDestObject(destKey)
      return message
    }
  }
}

async function handleMultiOutputFiles (sourcePath, profile, multifiles, outfile, job, jobPrefix) {
  let errorMessage = null
  const logPrefix = `handleMultiOutputFiles(${profile.name}, ${sourcePath}):`
  if (Array.isArray(multifiles)) {
    const minSize = m.minFileSize(sourcePath, profile.operation)
    multifiles.every((file) => {
      const size = util.statSize(file)
      const sizeOk = size >= minSize
      if (!sizeOk) {
        const message = `${logPrefix} asset file was too small (${size} < ${minSize}): ${file}`
        console.error(message)
        errorMessage = message
      }
      return sizeOk
    })
  } else {
    const message = `${logPrefix} somehow errorMessage === null but multifiles is not an array: ${JSON.stringify(multifiles)}`
    console.error(message)
    errorMessage = message
  }
  if (errorMessage === null) {
    // OK, upload all the thumbnails
    for (let i = 0; i < multifiles.length; i++) {
      const f = multifiles[i]
      console.log(`${logPrefix} uploading: ${f} ...`)
      const msg = await uploadAsset(sourcePath, f, job, jobPrefix)
      if (msg != null) {
        console.log(`${logPrefix} ERROR uploading (${f}) ${msg}`)
        errorMessage = msg
        break
      } else {
        console.log(`${logPrefix} upload ${f} SUCCESS`)
      }
    }
  }
  if (errorMessage !== null) {
    console.error(errorMessage)
    q.recordJobEvent(job, `${jobPrefix}_ERROR_multi_output`, errorMessage)
    s3util.recordError(sourcePath, profile.name, errorMessage)
  } else {
    console.log(`${logPrefix} clearing errors after successful upload)`)
    await clearErrors(job, jobPrefix, sourcePath, profile)
  }
  console.log(`${logPrefix} deleting local outfiles (${errorMessage ? `ERROR: ${errorMessage}` : 'after successful upload'})`)
  deleteLocalFiles(outfile, profile, job, jobPrefix)
}

function handleOutputFiles (job, sourcePath, profile, outfile) {
  const logPrefix = `handleOutputFiles(${profile.name}, ${sourcePath}):`
  const mediaType = profile.mediaType
  const jobPrefix = `${mediaType}_${profile.name}_handleOutputFiles`

  return async (code) => {
    console.log(`${logPrefix} starting with outfile ${outfile} and exit code ${code}`)
    if (code !== 0) {
      const message = `${logPrefix} child process exited with code ${code}`
      console.warn(message)
      q.recordJobEvent(job, `${jobPrefix}_ERROR_exit_code_nonzero`, `${code}`)
      s3util.recordError(sourcePath, profile.name, message)
      deleteLocalFiles(outfile, profile, job, jobPrefix)
      return
    }

    if (profile.multiFile) {
      const outfilePrefix = multifilePrefix(outfile)
      await glob(outfilePrefix + '*', async (err, files) => {
        console.log(`found multifiles in outfilePrefix ${outfilePrefix}: ${JSON.stringify(files)}`)
        if (err) {
          const message = `${logPrefix} GLOB: Error listing multifiles: ${err}`
          console.error(message)
          q.recordJobEvent(job, `${jobPrefix}_ERROR_listing_files`, `${err}`)
          s3util.recordError(sourcePath, profile.name, message)
          deleteLocalFiles(outfile, profile, job, jobPrefix)
        } else if (files && files.length && files.length > 0) {
          console.log(`${logPrefix} GLOB: SUCCESS: ${files.length} files matched!`)
          q.recordJobEvent(job, `${jobPrefix}_found_files`, `${files.length} files matched`)
          await handleMultiOutputFiles(sourcePath, profile, files, outfile, job, jobPrefix)
        } else {
          const message = `${logPrefix}  GLOB: No files matched!`
          console.error(message)
          q.recordJobEvent(job, `${jobPrefix}_ERROR_no_files_matched`)
          s3util.recordError(sourcePath, profile.name, message)
          deleteLocalFiles(outfile, profile, job, jobPrefix)
        }
      })
    } else {
      // stat the outfile -- it should be at least a minimum size
      const outfileSize = util.statSize(outfile)
      const minAssetSize = m.minFileSize(sourcePath, profile.operation)
      if (outfileSize < minAssetSize) {
        util.deleteFile(outfile)
        const message = `${logPrefix} profile/operation ${profile.name}/${profile.operation} (min size ${minAssetSize} not met) for outfile ${outfile}`
        console.warn(message)
        q.recordJobEvent(job, `${jobPrefix}_ERROR_min_size`, message)
        s3util.recordError(sourcePath, profile.name, message)
      } else {
        // file is OK, we can upload it to dest
        console.log(`${logPrefix} uploading ${outfile} ...`)
        const msg = await uploadAsset(sourcePath, outfile, job, jobPrefix)
        if (msg != null) {
          console.error(`${logPrefix} ERROR: ${msg}`)
          q.recordJobEvent(job, `${jobPrefix}_ERROR_uploading`, msg)
          s3util.recordError(sourcePath, profile.name, msg)
        } else {
          console.log(`${logPrefix} upload ${outfile} SUCCESS`)
          q.recordJobEvent(job, `${jobPrefix}_upload_success`)
        }
        console.log(`${logPrefix} clearing errors and deleting local files (after successful upload)`)
        await clearErrors(job, jobPrefix, sourcePath, profile)
        deleteLocalFiles(outfile, profile, job, jobPrefix)
      }
    }
  }
}

function mediaTransform (job, file, profile, outfile) {
  const mediaType = profile.mediaType
  const jobPrefix = `mediaTransform_${mediaType}_${profile.name}`

  if (!MEDIA_COMMANDS[mediaType]) {
    throw new TypeError(`invalid media type: ${mediaType}`)
  }
  const driverPath = `./driver/${mediaType}`
  const mediaDriver = require(driverPath)
  q.recordJobEvent(job, `${jobPrefix}_start`)
  const sourcePath = job.data.sourcePath
  const logPrefix = `${mediaType}:transform(${sourcePath}, ${file}, ${profile.name}):`
  console.log(`${logPrefix} starting with outfile ${outfile}`)
  if (typeof profile.operation === 'undefined') {
    console.log(`${logPrefix} no operation defined on profile, skipping: profile=${JSON.stringify(profile)}`)
    q.recordJobEvent(job, `${jobPrefix}_ERROR_invalid_operation`)
    return
  }
  if (!profile.enabled) {
    console.log(`${logPrefix} profile not enabled, skipping`)
    q.recordJobEvent(job, `${jobPrefix}_ERROR_not_enabled`)
    return
  }

  let xform
  if (profile.operation === m.OP_MEDIAINFO) {
    xform = mediainfo
  } else {
    xform = mediaDriver[profile.operation]
    if (!xform) {
      throw new TypeError(`${logPrefix}: operation '${profile.operation}' not supported: No function named ${profile.operation} exported from ${driverPath}`)
    }
  }
  const args = xform(sourcePath, file, profile, outfile)
  const outputHandler = handleOutputFiles(job, sourcePath, profile, outfile)
  console.log(`transform: running xform command: ${profileCommand(profile)} ${args.join(' ')}`)
  q.recordJobEvent(job, `${jobPrefix}_xform_${xform.name}`, `${profileCommand(profile)}`)
  runTransformCommand(job, profile, outfile, args, (code) => {
    q.recordJobEvent(job, `${jobPrefix}_outputHandler_start`, `${profileCommand(profile)} exit code: ${code}`)
    outputHandler(code).then(() => {
      q.recordJobEvent(job, `${jobPrefix}_outputHandler_COMPLETE`)
      console.log(`handleOutputFiles: finished (${profile.operation}/${profile.name}): ${sourcePath}`)
    })
  })
  q.recordJobEvent(job, `${jobPrefix}_DONE`)
}

async function createArtifacts (job, localSourceFile) {
  const sourcePath = job.data.sourcePath

  console.log('createArtifacts: starting with file: ' + localSourceFile)
  q.recordJobEvent(job, 'artifacts_start')

  const mediaType = m.mediaType(sourcePath)
  const profiles = m.mediaProfilesForSource(sourcePath)
  if (profiles === null) {
    console.log(`createArtifacts: no media profiles exist for path: ${sourcePath} (returning basic meta)`)
    q.recordJobEvent(job, 'artifacts_ERROR_no_profiles')
    return
  }

  for (const name in profiles) {
    const artifactPrefix = `artifact_${name}`
    const profile = profiles[name]
    if (!profile.enabled) {
      console.log(`createArtifacts: profile disabled, skipping: ${name}`)
      continue
    }

    let completedAssetKey
    let outfile

    // determine which destKey we will check to determine if the transform has completed
    if (profile.multiFile) {
      const outfilePrefix = path.dirname(localSourceFile) + '/' + m.ASSET_PREFIX + name
      outfile = outfilePrefix + m.assetSuffix(mediaType) + util.MULTIFILE_PLACEHOLDER + '.' + profile.ext
      completedAssetKey = util.canonicalDestDir(sourcePath) + m.ASSET_PREFIX + name + m.assetSuffix(mediaType) + util.MULTIFILE_FIRST + '.' + profile.ext
    } else {
      outfile = path.dirname(localSourceFile) + '/' + m.ASSET_PREFIX + name + m.assetSuffix(mediaType) + '.' + profile.ext
      completedAssetKey = util.canonicalDestDir(sourcePath) + path.basename(outfile)
    }

    q.recordJobEvent(job, `${artifactPrefix}_HEAD_dest`)
    const destHead = await s3util.headDestObject(completedAssetKey)
    if (destHead && destHead.ContentLength && destHead.ContentLength > 0) {
      console.log(`createArtifacts: artifact ${path.basename(completedAssetKey)} exists for profile ${name} (skipping) for source ${sourcePath}`)
      q.recordJobEvent(job, `${artifactPrefix}_SUCCESS_HEAD_dest`, 'all dest files exist, already processed')
      continue
    }
    const errCount = await s3util.countErrors(sourcePath, name)
    if (errCount >= MAX_XFORM_ERRORS) {
      console.warn(`createArtifacts: transcoding artifact for profile ${name} has failed too many times (${errCount} >= ${MAX_XFORM_ERRORS}) for ${sourcePath}, giving up`)
      q.recordJobEvent(job, `${artifactPrefix}_ERROR_err_count_exceeded`, `more than ${MAX_XFORM_ERRORS} errors, not retrying`)
      continue
    }

    q.recordJobEvent(job, `${artifactPrefix}_starting_xform_${mediaType}`)
    mediaTransform(job, localSourceFile, profile, outfile)
    q.recordJobEvent(job, `${artifactPrefix}_completed_xform_${mediaType}`)
  }
}

async function ensureSourceDownloaded (job) {
  const sourcePath = job.data.sourcePath
  const mediaType = m.mediaType(sourcePath)
  const jobPrefix = `ensureSourceDownload_${mediaType}`
  q.recordJobEvent(job, `${jobPrefix}_download_start`)

  // Does the local copy of the source exist already?
  const file = util.workbenchDir + util.canonicalWorkingDir(sourcePath) + util.canonicalSourceFile(sourcePath)
  const size = util.statSize(file)

  const sourceBucketParams = Object.assign({}, s3cfg.sourceBucketParams, { Key: sourcePath })
  if (size !== -1) {
    // we have a file with some size. do a HEAD request for the source
    // we might already have the whole file
    const head = await s3util.headSourceObject(sourcePath)
    if (head && head.ContentLength && head.ContentLength === size) {
      q.recordJobEvent(job, `${jobPrefix}_download_using_cached_source`)
      return file
    }
  }

  console.log(`ensureSourceDownload: downloading source to file: ${file}`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const MAX_TRIES = 10
  let head = null
  for (let i = 1; i <= MAX_TRIES; i++) {
    const attemptPrefix = `${jobPrefix}_download_attempt_${i}`
    try {
      await s3util.downloadObjectToFile(s3cfg.sourceClient, sourceBucketParams, file)
      const downloadSize = util.statSize(file)
      if (head == null) {
        q.recordJobEvent(job, `${attemptPrefix}_HEAD_source`)
        head = await s3util.headSourceObject(sourcePath)
      }
      if (head && head.ContentLength && head.ContentLength === downloadSize) {
        console.log(`ensureSourceDownload: successfully downloaded complete source file: ${file}`)
        q.recordJobEvent(job, `${attemptPrefix}_download_SUCCESS`)
        return file
      }
      let message
      if (head && head.ContentLength) {
        message = `ensureSourceDownload: downloaded file ${file} (size=${downloadSize}) which does not match source size: ${head.ContentLength}`
      } else {
        message = `ensureSourceDownload: downloaded file ${file} (size=${downloadSize}) but could never read ContentLength from HEAD: ${JSON.stringify(head)}`
      }
      console.error(message)
      q.recordJobEvent(job, `${attemptPrefix}_download_ERROR_size_mismatch`, message)
    } catch (err) {
      console.log(`ensureSourceDownload: ERROR downloading source file: ${file}: ${err}`)
      q.recordJobEvent(job, `${attemptPrefix}_download_ERROR`, `${err}`)
    }
  }
  // max tries exceeded
  console.log(`ensureSourceDownload: downloaded file ${file} failed, max tries exceeded (${MAX_TRIES})`)
  q.recordJobEvent(job, `${jobPrefix}_download_FAIL`, `max tries exceeded (${MAX_TRIES})`)
  return null
}

async function transform (sourcePath) {
  const logPrefix = `transform(${sourcePath}):`
  if (!m.hasProfiles(sourcePath)) {
    console.warn(`${logPrefix} no profiles exist, not transforming`)
    return null
  }

  console.log(`${logPrefix}) fetching metadata`)
  const derivedMeta = await manifest.deriveMetadata(sourcePath)
  if (derivedMeta && derivedMeta.status && derivedMeta.status.complete) {
    return derivedMeta
  }
  if (q.isQueued(sourcePath)) {
    if (q.isStaleJob(sourcePath)) {
      console.warn(`${logPrefix} already queued (at ${q.cdate(sourcePath)}), but that was too long ago (> ${q.MAX_JOB_TIME}), re-submitting job...`)
    } else {
      console.warn(`${logPrefix} already queued (at ${q.cdate(sourcePath)}), not re-queueing`)
      return derivedMeta
    }
  }

  console.log(`${logPrefix} adding to jobQueue: ${sourcePath}`)
  q.enqueue(sourcePath)
  return derivedMeta
}

export { transform }
