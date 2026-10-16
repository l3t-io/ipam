# Setting up L3T IPAM on a Synology

[Deutsch](SYNOLOGY.de.md)

Entirely in the browser, no SSH. Two ways:

- **Variant A — ready-made image (recommended, since 2.0):** Container Manager pulls the
  image `ghcr.io/l3t-io/ipam` itself. No code upload, updates via **Build**. The Synology
  needs internet access to the GitHub Container Registry.
- **Variant B — mounted code (the ZIP):** the container runs the official `node:22-alpine`
  and starts the application from the uploaded folder. Works without a registry. This is
  how 1.x ran.

Takes about five minutes.

---

## Variant A — ready-made image

1. File Station: in the shared folder `docker`, create the folder `l3t-ipam` and inside it
   `data`. (No `docker` folder? Control Panel → Shared Folder → Create.)
2. Container Manager → **Project** → **Create**, name `l3t-ipam`, path
   `docker/l3t-ipam`, source **Create docker-compose.yml**, and paste the content of
   [`deploy/synology/docker-compose.yml`](deploy/synology/docker-compose.yml).
   Put your own domain into `IPAM_DOMAIN`.
3. **Next** → **Done**. Then continue with «3. Set up the account».

`PUID`/`PGID` decide who owns the data folder; `1026`/`100` fits the first user of a
Synology. If the log says «could not chown» or «may not write», the app still runs, as
root then. Cleaner is to give the folder the permission, see «If something doesn't start».

**Switching from variant B:** Project → **Action → Edit**, replace the content of the
Compose file with the image variant, **Save**, then **Build**. The `data/` folder stays as
it is; `app/` can go afterwards.

**Updating:** Container Manager → **Image** → take the offered update for
`ghcr.io/l3t-io/ipam`, then Project → **Action → Build**. The Compose file uses the tag
`:2` — you get every 2.x version, but no unchecked jump to 3.0.

---

## Variant B — mounted code

## 1. Upload the files (File Station)

1. Open File Station. If the shared folder `docker` is missing: Control Panel → Shared
   Folder → Create → name `docker`.
2. Go into the `docker` folder.
3. Upload → choose the ZIP.
4. Right-click the uploaded ZIP → **Extract** → **Extract here**.

The structure must then look like this:

```
/volume1/docker/l3t-ipam/
├── app/
│   ├── server.js
│   ├── auth.js
│   └── public/          (incl. fonts/, logo.svg and login.html)
├── data/
└── docker-compose.yml
```

You can delete the ZIP afterwards.

> If extracting creates an extra folder level (`l3t-ipam/l3t-ipam/…`), move the inner
> folder one level up. The paths in the Compose file assume `/volume1/docker/l3t-ipam`.

---

## 2. Create the project (Container Manager)

1. Open Container Manager → **Project** → **Create**.
2. Project name: `l3t-ipam`
3. Path: **Set path** → choose `docker/l3t-ipam`.
4. Source: **Use existing docker-compose.yml** — the file is detected and shown in the
   editor.
5. **Next** → skip the web portal settings → **Next** → **Done**.

Container Manager downloads `node:22-alpine` and starts the container. The first time
this takes a minute or two.

---

## 3. Set up the account

On first start there is no account yet. The application writes a setup code to the log
for that:

1. Container Manager → **Container** → `l3t-ipam` → **Log**.
2. There is a block with `setup code to create an account:   ABCD-EFGH-JKLM`.
3. Open `http://<synology-ip>:8480`. «Set up account» appears.
4. Enter the code, a user name and a password (at least 12 characters) → **Create
   account**.

The code is valid until the next container restart and isn't needed afterwards. From now
on the sign-in page appears. The password is only stored as a scrypt hash in
`data/auth.json`.

Change password and sign out: the person icon at the top right.

Add more users via the gear → **Users**. There are three roles:

| Role | May |
|---|---|
| Administrator | everything, including users, UniFi settings and import |
| Editor | maintain networks and hosts, apply the UniFi sync |
| Viewer | see everything, change nothing |

The first account is an administrator. A role change takes effect immediately, without
signing in again. When an administrator resets a password or deletes an account, that
person is signed out on all devices at once. The last administrator can neither be
deleted nor demoted.

If the port is taken, change the left number under `ports` in the editor, e.g.
`8481:8080`, and build the project again.

---

## 4. Optional: a name instead of a port

Control Panel → Login Portal → Advanced → **Reverse Proxy** → Create:

| Field | Value |
|---|---|
| Source protocol | HTTPS |
| Source hostname | `ipam.example.com` |
| Source port | 443 |
| Destination protocol | HTTP |
| Destination hostname | `localhost` |
| Destination port | 8480 |

Plus a DNS record pointing to the Synology. If a Cloudflare Tunnel sits in front anyway,
point it at `http://<synology-ip>:8480`.

**No Cloudflare Access needed.** The application has its own sign-in. The line
`IPAM_TRUST_PROXY: "1"` in the Compose file makes sure the real client address counts
behind a tunnel or reverse proxy.

---

## Sign-in — what's behind it

- Session cookie with `HttpOnly` and `SameSite=Strict`, plus `Secure` over HTTPS.
  Without «Stay signed in» the session ends after 12 hours of inactivity, with it after
  30 days.
- After 10 failed attempts within 15 minutes the client address is locked for 15
  minutes. With more than 100 failed attempts per hour in total, sign-in slows down for
  everyone — a container restart resets that.
- Every attempt is logged, with the client address.
- `IPAM_TRUST_PROXY: "1"` trusts proxy headers from anywhere. If port 8480 is reachable
  directly on the LAN, someone there can fake a client address and get around the
  per-address lock. Safer: enter only the proxy's address, e.g. that of the Cloudflare
  Tunnel container or `127.0.0.1` for the Synology's reverse proxy — several separated by
  commas, networks work too (`172.16.0.0/12`).
- Changing the password signs out all other devices.

**Forgot the password?** Another administrator resets it via gear → Users.

If there is no other administrator, a temporary emergency account helps:

1. Container Manager → Project → **Action → Edit**, add under `environment`:
   ```yaml
         IPAM_USER: emergency
         IPAM_PASS: a-long-one-time-password
   ```
2. Build the project, sign in as `emergency` and set your own password again under
   gear → Users.
3. Remove the two lines and build the project again.

All other users are kept. Only as a last resort: delete `data/auth.json` and restart —
then **all** accounts are gone, and «Set up account» appears again with a new code in the
log. The IPAM inventory stays untouched either way.

**Fixed account** (instead of setting it up in the browser): set `IPAM_USER` and
`IPAM_PASS` under `environment` in the editor. That gives an additional administrator
whose password sits in plain text in the Compose file and can't be changed in the
browser — for everyday use an account created in the browser is the better way.

**Turning sign-in off** (e.g. when Cloudflare Access is in front after all):
`IPAM_AUTH: "off"`. The log then warns on every start.

---

## Connecting UniFi (optional)

Create a key in UniFi: open Network → Settings → Control Plane → Integrations → **Create
New API Key**. The key is shown only once. The account you create it with needs
administrator rights, and the key inherits exactly its permissions.

Then in the web interface, the **gear** at the top right → section «UniFi connection»:

1. Enter the controller address, e.g. `https://10.1.1.1`.
2. Paste the API key; the site is usually `default`.
3. **Test connection** — shows how many networks, devices and clients can be read.
4. **Save**. A «UniFi» button then appears at the top.

It's stored in `data/unifi.json`, separate from the inventory. That's why the key shows
up neither in the export nor in the web interface — there it just says «saved …abcd».
An update or a new Compose file leaves it untouched.

The **security zone** of each network (zone-based firewall, Network 9 and later) is taken
from UniFi automatically and is then locked in the network form — change it in UniFi.
For networks UniFi doesn't know, you can enter it by hand.

**Managing zones:** «Security zones» in the sidebar (or «Manage» in the overview) lists
all zones. The sync creates zones from UniFi that don't exist yet; their name belongs to
UniFi, colour and description can be changed here. Your own zones can be created,
renamed (networks follow) and deleted (networks are then without a zone). A network
takes the colour of its zone; the network's own colour only applies without a zone. If a
zone disappears from UniFi, it stays here as a manual zone.

**Offline devices:** under gear → UniFi → Offline devices you set after how many days
without a sign of life a documented host counts as offline, and whether it is then
removed automatically. Default: manual only, DHCP entries only, 30 days. Mark devices that
rarely check in (battery sensors and the like) as «sporadic» on the host — those always
stay. A daily backup is written before anything is removed.

**Certificate:** when saving, the app remembers the controller's certificate and checks
it on every connection before the key is sent. If the sync reports «The controller
certificate has changed» and you've just updated the controller: simply save the
connection under gear → UniFi again.

To use a new key, just enter it in the same field. When the address changes, the key
must be entered again — so the old one never goes to a different address.

Still have the connection in `IPAM_UNIFI_URL`/`IPAM_UNIFI_KEY` in the Compose file? That
keeps working, and the web interface shows it. Save it there once; from then on the web
interface applies and the lines in the Compose file can go.

Important: the Synology must be allowed to reach the controller. If it's in a different
VLAN, you need a matching firewall rule.

## Data and backup

The entire inventory is readable JSON in `/volume1/docker/l3t-ipam/data/`:

- `ipam.json` — current state, including the chosen appearance
- `auth.json` — users, roles and password hashes
- `unifi.json` — UniFi address and API key
- `ipam-YYYY-MM-DD.bak.json` — automatic daily backup, the last 14 are kept

So every Hyper Backup of the `docker` folder includes the IPAM as well. In addition, the
«Export» button in the web interface downloads the same state as a file.

---

## Updating

Replace the files in `app/` via File Station, then click **Action → Build** on the
project in Container Manager. The data folder stays untouched. The running version is
shown in the web interface next to the logo.

All settings you enter yourself (account, UniFi) live in the data folder, so the Compose
file from the package can be taken over safely.

**Coming from 1.4 or older:** also replace the Compose file with the one from the ZIP
(Project → **Action → Edit**, keep a changed port). It has the health check on
`/healthz`; with the old one the app runs, but the container shows as «unhealthy». Then
fetch the setup code as in «3. Set up the account».

## If something doesn't start

**`unable to evaluate symlinks in Dockerfile path`** — the project tries to build an
image. The supplied Compose file doesn't do that; it uses the ready-made image. In
Container Manager, check under **Action → Edit** whether the editor contains a `build:`
line. If so, replace the content with the `docker-compose.yml` from the package and build
the project again.

**`EACCES: permission denied, open '/data/…'`** — the container may not write to the data
folder. On a Synology the File Station permissions decide, not the folder's owner. To
grant them:

1. File Station → `docker/l3t-ipam` → right-click `data` → **Properties** →
   **Permission** → **Create**.
2. User or group: **Everyone**, tick **Read** and **Write** → **Done**.
3. Tick **Apply to this folder, sub-folders and files** → **Save**.
4. Container Manager → Project → **Action → Build**.

Instead of **Everyone**, the user matching `PUID` works too (via SSH: `id`).

Otherwise: Container Manager → Container → `l3t-ipam` → **Log**. On start the application
logs a line with version, port and loaded inventory. If it's missing, the path is usually
wrong: `app/server.js` must sit directly in the folder given in the Compose file.
