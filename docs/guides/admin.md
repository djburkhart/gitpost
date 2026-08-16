# Admin

The **admin** link appears only if your account is an administrator. Everyone else sees “This console is reserved for administrators.”

This page is for people who already have that role on a running site. It does not cover deploying gitpo.st.

## What you can do

The console has five tabs.

### Users

Every identity: handle, name, role, active or disabled.

Administrators can **Disable** or **Enable** an account (except the super admin). A disabled account cannot sign in; its sessions are dropped.

The **super admin** (`@danny` on a new site) is protected. You cannot disable, demote, or remove that account.

**Make admin** / **Demote** and **Remove** are super-admin only. Remove cannot be undone.

### Invites

**Mint invite** creates a one-time code (14 days). Share the code, or a join link with `?invite=`.

Unused codes can be **Revoked**. Used codes show who redeemed them.

Regular members cannot mint invites. If someone asks how to invite a friend, an admin does it here.

### Sessions

Every live session on the site. **Revoke** signs that device out.

### Audit

A log of admin actions: who did what, to which target.

### Policy

- **Signup mode**
  - **Invite only** — join requires a valid, unexpired code (the usual setting)
  - **Open registration** — no code
  - **Closed** — join is refused
- **Minimum password length** — 12 to 64. New passwords still need a letter and a number.

**Save policy** applies immediately to the next registration.

## Posts

On any object, an administrator sees **Remove post**. That permanently deletes the object. Confirm before you click.

## Roles, briefly

| Role | Typical powers |
| --- | --- |
| **member** | Write, fork, review, watch remotes |
| **admin** | All of that, plus this console (except promote/remove users) |
| **superadmin** | Admin, plus promote, demote, and remove users. Cannot be modified through the console |

## What not to put in chat

Do not paste deploy tokens, Worker secrets, or the bootstrap admin password into user-facing notes. Those belong in the operator README, not here.
