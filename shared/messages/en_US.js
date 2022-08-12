export default {
  // titles and labels
  welcome: 'Welcome {{user.firstName || user.email.includes("@") ? user.email.substring(0, user.email.indexOf("@")) : user.email}}',
  title_login: 'Sign In',
  title_register: 'Sign Up',
  title_verifying: 'Verifying your account...',
  title_requestPasswordReset: 'Reset your password',
  title_resetPassword: 'Set a new password',
  title_verifying_ended: 'Verification ended',
  label_firstName: 'First Name',
  label_lastName: 'Last Name',
  label_email: 'Email',
  label_password: 'Password',
  label_newPassword: 'New password',
  label_locale: 'Language',
  label_token: 'Verification token',
  label_ctime: 'Created',
  label_mtime: 'Modified',
  button_login: 'Sign In',
  button_logout: 'Sign Out',
  button_register: 'Sign Up',
  button_forgot_password: 'Forgot your password?',
  button_send_password_reset_email: 'Send',
  button_set_new_password: 'Set Password',
  info_password_reset_email_sent: 'An email message was sent to {{ email }}, check your inbox for a link to reset your password',
  info_password_reset_try_again: 'Try again',
  button_invite_friends: 'Invite your friends to {{ title }}!',
  button_close_invite_friends: 'close',
  label_friend_emails: 'List of emails separated by commas, spaces or newlines',
  button_send_invitations: 'Send invitations',
  info_invite_friends: 'Invite your friends to {{ title }}! Enter some email addresses here and we\'ll send them an invitation',
  info_invite_friends_limited_registration: 'The operator of {{ title }} has limited registration to specific people. You are welcome to send invites, but these users must also be added the the approved list of users by the site administrator before they\'ll be able to successfully create an account',
  info_invite_friends_disabled_no_email: 'The "invite friends" feature is disabled because email hasn\'t been configured on {{ title }}',
  info_invitation_success_results: 'Your invitation was successfully sent to {{ successCount }} friends',
  info_invitation_error_results: 'Your invitation could not be delivered to {{ errorCount }} friends',

  label_search: 'Search',
  button_search: 'Search',
  label_sort: 'Sort by',
  label_sort_order: 'Order',
  label_sort_ascending: 'ascending',
  label_sort_descending: 'descending',

  // vee-validate error types
  error_field_required: '{{ field }} is required',
  error_field_invalid: '{{ field }} is not valid',
  error_field_regex: '{{ field }} is not valid',
  error_field_min: '{{ field }} is too short',
  error_field_max: '{{ field }} is too long',
  error_field_email: '{{ field }} is not a valid email address',
  error_field_cannotDeleteSelf: 'You cannot delete yourself',

  // Locale names -- add more translations if other locales are added
  locale_en_US: 'English (US)',
  locale_es_US: 'Spanish (US)',
  locale_es_ES: 'Spanish',
  locale_it_IT: 'Italian',
  locale_fr_FR: 'French',
  locale_de_DE: 'German',
  locale_en_GB: 'English (GB)',

  // Date/Calendar names
  label_date: '{{MMM}} {{d}}, {{YYYY}}',
  label_date_short: '{{M}}/{{d}}/{{YYYY}}',
  label_date_and_time: '{{MMM}} {{d}}, {{YYYY}} / {{h}}:{{m}}{{a}}',
  label_date_and_time_short: '{{M}}/{{d}}/{{YYYY}} {{h}}:{{m}}{{a}}',
  label_date_undefined: 'Date/time not set',
  label_date_day_half_am: 'AM',
  label_date_day_half_pm: 'PM',
  label_date_day_0: 'Sunday',
  label_date_day_1: 'Monday',
  label_date_day_2: 'Tuesday',
  label_date_day_3: 'Wednesday',
  label_date_day_4: 'Thursday',
  label_date_day_5: 'Friday',
  label_date_day_6: 'Saturday',
  label_date_day_short_0: 'Sun',
  label_date_day_short_1: 'Mon',
  label_date_day_short_2: 'Tue',
  label_date_day_short_3: 'Wed',
  label_date_day_short_4: 'Thu',
  label_date_day_short_5: 'Fri',
  label_date_day_short_6: 'Sat',
  label_date_month_0: 'January',
  label_date_month_1: 'February',
  label_date_month_2: 'March',
  label_date_month_3: 'April',
  label_date_month_4: 'May',
  label_date_month_5: 'June',
  label_date_month_6: 'July',
  label_date_month_7: 'August',
  label_date_month_8: 'September',
  label_date_month_9: 'October',
  label_date_month_10: 'November',
  label_date_month_11: 'December',
  label_date_month_short_0: 'Jan',
  label_date_month_short_1: 'Feb',
  label_date_month_short_2: 'Mar',
  label_date_month_short_3: 'Apr',
  label_date_month_short_4: 'May',
  label_date_month_short_5: 'Jun',
  label_date_month_short_6: 'Jul',
  label_date_month_short_7: 'Aug',
  label_date_month_short_8: 'Sep',
  label_date_month_short_9: 'Oct',
  label_date_month_short_10: 'Nov',
  label_date_month_short_11: 'Dec',
  label_date_month_number_0: '1',
  label_date_month_number_1: '2',
  label_date_month_number_2: '3',
  label_date_month_number_3: '3',
  label_date_month_number_4: '5',
  label_date_month_number_5: '6',
  label_date_month_number_6: '7',
  label_date_month_number_7: '8',
  label_date_month_number_8: '9',
  label_date_month_number_9: '10',
  label_date_month_number_10: '11',
  label_date_month_number_11: '12',

  // Site Administration
  admin_title_site_administration: '{{ title }} Administration',
  admin_title_user_administration: 'User Administration',
  admin_title_migrate_users: 'Migrate users from previous encryption key',
  admin_title_transform_queue: 'Media Transform Queue',

  // User Administration
  admin_label_total_user_count: '{{ totalUserCount }} total users',
  admin_button_delete_user: 'Delete User',
  admin_label_confirm_user_delete: 'Please confirm deletion of the user: {{ email }}',

  // Transform Queue
  admin_label_firstEvent: 'first event',
  admin_label_lastEvent: 'last event',
  admin_label_eventTime: 'time',
  admin_label_eventName: 'event',
  admin_label_eventDescription: 'description',

  // User Migration
  admin_label_migration_results: 'User migration results:',
  admin_label_migration_oldKey: 'Previous encryption key',
  admin_label_migration_oldIV: 'Previous initialization vector (IV) (if one was set)',
  admin_button_migrate_users: 'Migrate Users',
  admin_title_main_site: 'Back to {{ title }}'

}
