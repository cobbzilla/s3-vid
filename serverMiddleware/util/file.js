import fs from 'fs'

const shasum = require('shasum')
const c = require('../../shared')
const s3cfg = require('../s3/s3client')

const workbenchDir = process.env.YB_WORK_DIR.endsWith('/')
  ? process.env.YB_WORK_DIR
  : process.env.YB_WORK_DIR + '/'

const LAST_MODIFIED_FILE = 'lastModified'
const SELECTED_THUMBNAIL_FILE = 'selectedThumbnail.json'

const ERROR_FILE_PREFIX = '_error_'

const MULTIFILE_PLACEHOLDER = '%03d'
const MULTIFILE_FIRST = '001'
const INCLUDE_ORIG_FILENAME_CHARS = 20

function statSize (file) {
  const stats = fs.statSync(file, { throwIfNoEntry: false })
  if (stats && stats.size) {
    return stats.size
  }
  return -1
}

function scrub (path) {
  // replace all nonalphanumeric chars with underscores
  const scrubbed = path.replace(/[\W_]+/g, '_')

  // retain the first several characters, then add a hash
  return (scrubbed.length < INCLUDE_ORIG_FILENAME_CHARS
    ? scrubbed
    : scrubbed.substring(scrubbed.length - INCLUDE_ORIG_FILENAME_CHARS, scrubbed.length)) +
    '_' + shasum(path)
}

function canonicalWorkingDir (path) {
  return scrub(path) + '/'
}

function canonicalDestDir (path) {
  const slug = scrub(path)
  const sha = shasum(path)
  const rawPrefix = s3cfg.destBucketParams.Prefix
  const prefix = rawPrefix.endsWith('/') ? rawPrefix : rawPrefix + '/'
  const canonical = prefix + sha.substring(0, 2) +
    '/' + sha.substring(2, 4) +
    '/' + sha.substring(4, 6) +
    '/' + slug +
    '/'
  // console.log('canonicalDestDir(' + path + ') returning ' + canonical)
  return canonical
}

function canonicalSourceFile (path) {
  const base = path.endsWith('/') ? path.substring(0, path.length - 1) : path
  const slash = base.lastIndexOf('/')
  const file = slash === -1 ? base : base.substring(slash)
  const ext = c.getExtension(file).toLowerCase()
  const canonical = 'source.' + ext
  return canonical
}

function deleteFile (path) {
  fs.unlink(path, (err) => {
    if (err) {
      console.error('Error deleting path: ' + path)
    }
  })
}

const REDIS_META_PREFIX = 'CACHED_META_'

function redisMetaCacheKey (sourcePath) {
  return REDIS_META_PREFIX + shasum(sourcePath)
}

export {
  canonicalSourceFile, canonicalWorkingDir, canonicalDestDir,
  deleteFile, statSize, redisMetaCacheKey,
  workbenchDir,
  MULTIFILE_PLACEHOLDER, MULTIFILE_FIRST,
  LAST_MODIFIED_FILE, SELECTED_THUMBNAIL_FILE, ERROR_FILE_PREFIX
}
