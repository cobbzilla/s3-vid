const q = require('../../asset/job')
const api = require('../../util/api')
const u = require('../../user/userUtil')

export default {
  path: '/api/admin/queue',
  async handler (req, res) {
    const user = await u.requireAdmin(req, res)
    if (!user) {
      return
    }
    console.log(`>>>>> API: Queue ${req.url}`)
    const queue = q.getQueue()
    return api.okJson(res, queue)
  }
}
