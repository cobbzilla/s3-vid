const api = require('../../util/api')
const valid = require('../../../shared/validation')
const u = require('../../user/userUtil')

export default {
  path: '/api/user/inviteFriends',
  async handler (req, res) {
    const user = await u.requireUser(req, res)
    if (!user) {
      return api.forbidden(res)
    }
    req.on('data', (data) => {
      const emails = JSON.parse(data.toString())
      const emailList = valid.findValidEmails(emails)
      if (emailList.length === 0) {
        return api.validationFailed(res, { email: ['required'] })
      }
      u.sendInvitations(user, emailList).then(
        results => api.okJson(res, results),
        (err) => {
          const message = `inviteFriends: sendInvitations error: ${err}`
          console.error(message)
          return api.serverError(res, message)
        })
    })
  }
}
