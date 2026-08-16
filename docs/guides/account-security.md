# Account security

**security** in the header manages this identity. It is not a profile editor.

## Identity

You see `@handle` and your role (`member`, `admin`, or `superadmin`). The handle does not change here.

## Password

**Update password** asks for the current password and a new one. The new password must meet the site policy — at least 12 characters, with a letter and a number, unless an administrator set a higher minimum.

On success, **other sessions are signed out**. This session stays open.

After five failed sign-ins the account locks for 15 minutes. Wait, then try again.

## Sessions

**active sessions** lists devices: this one, plus others with IP and age.

- **Revoke** ends one other session.
- **Sign out other devices** ends every session except this one.

Sessions last 30 days unless you revoke them.

**Sign out** on your profile ends only this session.

## Attribution preference

See [Inbox and profiles](inbox-and-profiles.md) for the “don’t notify me when someone derives from my work” checkbox.

## Tips

- Change the first password you were given as soon as you can.
- If a session looks wrong, revoke it, then update the password so everything else drops.
- There is no email reset in the app. If you are locked out, an administrator has to help.
