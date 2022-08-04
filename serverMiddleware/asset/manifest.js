const path = require('path')
const shasum = require('shasum')
const redis = require('../redis')
const s3util = require('../s3/s3util')
const util = require('../util')
const c = require('../../media')

const MIN_CACHE_PERIOD = 5 * 60 * 1000 // 5 minutes

async function deriveMetadata (sourcePath) {
  // Do we have this cached?
  const cacheKey = 'CACHED_META_' + shasum(sourcePath)
  const cachedMeta = JSON.parse(await redis.get(cacheKey))
  if (cachedMeta && cachedMeta.ctime) {
    // if the cache ctime is within a short period, don't even bother checking the destination
    if (Date.now() - cachedMeta.ctime < MIN_CACHE_PERIOD) {
      console.log(`'deriveMetadata cache is young, returning it: ${JSON.stringify(cachedMeta)}`)
      return cachedMeta
    }
    // check last-modified time on directory
    const lastModified = await s3util.headDestObject(util.canonicalDestDir(sourcePath) + util.LAST_MODIFIED_FILE)
    if (lastModified && lastModified.LastModified) {
      const destModified = Date.parse(lastModified.LastModified)
      if (destModified > cachedMeta.ctime) {
        console.log(`deriveMetadata: destination modified after cache created, recreating for source: ${sourcePath}`)
      } else {
        // the cache is valid!
        return cachedMeta
      }
    } else {
      console.log(`deriveMetadata recalculating because lastModified file does not exist or is newer than cache for sourcePath: ${sourcePath}`)
    }
  } else {
    console.log(`deriveMetadata no data in cache, recalculating for: ${sourcePath}`)
  }

  const meta = {
    ctime: Date.now(),
    assets: {},
    status: {}
  }

  const profiles = c.mediaProfilesForSource(sourcePath)
  if (profiles === null) {
    console.log(`no media profiles exist for path: ${sourcePath} (returning basic meta)`)
    return meta
  }

  // find all assets
  const prefix = util.canonicalDestDir(sourcePath) + c.ASSET_PREFIX
  const assets = await s3util.listDest(prefix)
  assets.forEach((asset) => {
    const base = path.basename(asset.name)
    const underscore = base.indexOf('_')
    const dot = base.indexOf('.')
    if (underscore !== -1 && dot !== -1 && dot > underscore) {
      const foundProfile = base.substring(underscore + 1, dot)
      if (foundProfile in profiles) {
        if (profiles[foundProfile].multiFile) {
          if (!(foundProfile in meta.assets)) {
            meta.assets[foundProfile] = []
          }
          meta.assets[foundProfile].push(asset.name)
        } else {
          meta.assets[foundProfile] = [asset.name]
        }
      }
    }
  })

  // determine if everything is done, and if "enough" is done
  let allAssetsDone = true
  let primaryAssetsDone = false
  for (const name in profiles) {
    if (!(name in meta.assets)) {
      allAssetsDone = false
    } else if (profiles[name].primary) {
      primaryAssetsDone = true
    }
  }

  if (allAssetsDone) {
    meta.status.complete = true
  }
  if (primaryAssetsDone) {
    meta.status.ready = true
  }

  await redis.set(cacheKey, JSON.stringify(meta))
  console.log('deriveMetadata returning: ' + JSON.stringify(meta))
  return meta
}

export { deriveMetadata }
