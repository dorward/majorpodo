# Authentication through Nginx

Majorpodo v2 delegates authentication to the reverse proxy. Express does not
validate Basic Auth credentials. The supported deployment described here is
host Nginx providing HTTPS and Basic Auth in front of the Docker HTTP service.
Database credentials in `configuration/` are separate from podcast user accounts.

## Example configuration

[nginx-majorpodo.conf](nginx-majorpodo.conf) provides an example server block
for `/etc/nginx/sites-enabled/majorpodo.example.com`, including Certbot-managed
settings. Replace `majorpodo.example.com` throughout with your own domain and
use the certificate paths created for that domain. It is a reference, not a configuration automatically
installed by Compose. Certificates, `/etc/majorpodo/htpasswd`, and Nginx's web
root remain on the host.

The request flow is:

1. Clients request `https://majorpodo.example.com` over TLS.
2. `location /` checks the username/password against `/etc/majorpodo/htpasswd`,
   using the realm `Majorpodo`.
3. After authentication, `try_files $uri @proxy` serves a matching file from the
   Nginx web root or internally passes the request to the named `@proxy` location.
4. `@proxy` forwards the original request path to `http://127.0.0.1:3000`.

Authentication runs in Nginx's access phase, before the `try_files` phase.
Consequently, the example normal request path is authenticated before it can
reach `@proxy`. The named location does **not** inherit directives from its
sibling `location /`; its protection relies on that authenticated entry path.
If adding other locations or internal redirects, preserve this boundary. Putting
`auth_basic` and `auth_basic_user_file` at `server` scope is an alternative that
lets ordinary locations inherit protection; keep `auth_basic off` only for
intentional public locations. See the [Nginx processing phases](https://nginx.org/en/docs/dev/development_guide.html#http_phases)
and [Basic Auth inheritance](https://nginx.org/en/docs/http/ngx_http_auth_basic_module.html).

Show pages, episode pages, RSS, media enclosures, artwork, and static assets all
use the protected `/` entry location. The `proxy_pass` directive has no URI
suffix, preserving these paths when forwarding to Express. See the
[proxy_pass reference](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass).

`location ^~ /.well-known/` intentionally permits public files, such as existing
certificate challenge files, under the Nginx web root. Keep private content out
of that directory. Its `/index.html` fallback can re-enter the authenticated
location when a requested file is absent. Port 80 handling and Certbot renewal
configuration are outside the example HTTPS server block.

## Keep the upstream private

Nginx authentication only protects requests passing through Nginx. For this
same-host deployment, the supplied Compose file binds Docker's published HTTP
port to loopback. Keep this HTTP `ports` entry:

```yaml
services:
  majorpodo-http:
    ports:
      - target: 3000
        published: 3000
        host_ip: 127.0.0.1
```

Keep `listen.host: 0.0.0.0` inside the application container. If using an IPv4-only
host binding, `proxy_pass http://127.0.0.1:3000;` makes the Nginx upstream address
explicit. Match ports if changing `listen.port`.

The repository defaults to the loopback binding above. Verify that the deployed
Compose file retains it; this does not establish the live host's current mapping.
Recreate
the HTTP container after changing the mapping. Run these wrapper commands from
the project checkout (see the deployment requirements in [README.md](../README.md)):

```sh
./run.sh up -d --no-deps majorpodo-http
./run.sh port majorpodo-http 3000
```

The published address should be `127.0.0.1:3000`. A direct request to that port
from another machine should fail to connect (also check public IPv6 if enabled).
A direct unauthenticated request from the server to its own loopback upstream
is expected to work: local processes are inside this deployment's trust boundary.

## Manage podcast accounts

Use `htpasswd` on the Nginx host. On Debian/Ubuntu it is provided by
`apache2-utils`. For an existing password file, add a user or change a password
with an interactive prompt:

```sh
sudo htpasswd /etc/majorpodo/htpasswd podcast
```

For the first account in a **new** file, add `-c`. Do not use `-c` to update an
existing file: it replaces the file. Make the parent directory traversable and
the file readable by the Nginx worker account. For a Debian/Ubuntu worker group
of `www-data`, suitable file ownership/permissions are `root:www-data` and
`0640`; adjust for the actual Nginx worker group. Keep this file out of the web
root and Git. See [Nginx's password-file instructions](https://docs.nginx.com/nginx/admin-guide/security-controls/configuring-http-basic-authentication/).

Use the podcast client's authentication settings for the HTTPS feed URL.
The client must send credentials for both feed and enclosure requests; fetching
RSS successfully alone does not demonstrate that downloads work. Credentials
are needed for artwork as well. Avoid embedding passwords in shared URLs.

## Nominate administrators

`/_admin/` lists administrative pages; `/_admin/discovery/` reports scanner
observations and alias rules. These pages expose filesystem paths and import
errors. Express delegates their access control to Nginx too; there is no
application admin account or trusted username-header mechanism.

The example server block has two additional locations:

```nginx
location = /_admin {
    auth_basic "Majorpodo";
    auth_basic_user_file /etc/majorpodo/htpasswd-admin;
    proxy_pass http://127.0.0.1:3000;
}
location ^~ /_admin/ {
    auth_basic "Majorpodo";
    auth_basic_user_file /etc/majorpodo/htpasswd-admin;
    proxy_pass http://127.0.0.1:3000;
}
```

Both locations authenticate directly before proxying. Do not forward admin
requests through the ordinary `try_files`/`@proxy` entry path, whose password
file admits all podcast users. The exact location covers the slashless entry
point; the prefix protects every existing and future admin subpage. Do not add
a URI suffix to `proxy_pass`, which must preserve `/_admin/...`.

Nominate existing podcast users by copying **only their selected account
lines** from `/etc/majorpodo/htpasswd` into `/etc/majorpodo/htpasswd-admin`.
For example, to replace the complete admin list with just `admin-user`:

```sh
sudo awk -F: '$1 == "admin-user"' /etc/majorpodo/htpasswd \
  | sudo tee /etc/majorpodo/htpasswd-admin > /dev/null
sudo chown root:www-data /etc/majorpodo/htpasswd-admin
sudo chmod 640 /etc/majorpodo/htpasswd-admin
```

Replace `admin-user` with the nominated username and `www-data` with the actual
Nginx worker group. For multiple admins, select each explicitly, for example
`$1 == "admin-user" || $1 == "second-admin"`. A username not found in the main
file adds no entry and gains no access. This command replaces the previous
admin list; copying the whole podcast password file would make everyone admin.
Keep both files outside the web root and readable by Nginx.

Using the same stored account line preserves the username/password and realm,
so the nominated user can browse both normal and admin pages. After changing
that user's main password, update their admin entry too. Remove their entry
from the admin file to revoke admin access while retaining podcast access.
Accounts absent from the admin file, including valid ordinary podcast users,
receive a `401` challenge on admin URLs. This uses Nginx's documented
[per-location password files](https://nginx.org/en/docs/http/ngx_http_auth_basic_module.html#auth_basic_user_file).

After `sudo nginx -t`, reload Nginx. Verify all of these on the live server:

```sh
base=https://majorpodo.example.com
curl --head "$base/_admin"
curl --head "$base/_admin/"
curl --head "$base/_admin/discovery/"
curl --head --user ordinary-user "$base/"
curl --head --user ordinary-user "$base/_admin/"
curl --head --user ordinary-user "$base/_admin/discovery/"
curl --head --user admin-user "$base/_admin/"
curl --head --user admin-user "$base/_admin/discovery/"
```

Unauthenticated admin requests and ordinary users should get `401`. The ordinary
user's home request and nominated admin's page requests should get `200` once
discovery tracking is ready. With admin credentials, `/_admin` redirects to
`/_admin/`. Also confirm unknown `/_admin/...` pages require admin credentials,
and `/_ADMIN/discovery/` never renders the report. Keep the loopback binding
and verify the upstream cannot be reached publicly: direct Express access has
no password enforcement. Do not mark these live checks complete until run on
the server.

## Verify on the deployment

The example server block has been reviewed against Nginx's documented request
flow. **Live authentication has not been tested from this checkout.** The
following checks need the deployment host and a valid podcast account.

Check the installed configuration and reload only if it passes:

```sh
sudo nginx -t && sudo systemctl reload nginx
```

Without credentials, these requests should return `401` and a
`WWW-Authenticate: Basic realm="Majorpodo"` challenge. Even nonexistent private
paths should be challenged before reaching the application:

```sh
base=https://majorpodo.example.com
for resource in / /static/style.css /Example%20Show/rss /media/example.mp3 /images/example.jpeg; do
    curl --silent --show-error --head "$base$resource"
done
curl --silent --show-error --head --user invalid-test-user:invalid-test-password "$base/"
```

The invalid test account should also receive `401`. For valid credentials, use
`--user` with only the username so curl prompts for the password. Replace
placeholder paths with a real show, episode, media file, and image from the site:

```sh
curl --head --user podcast "$base/"
curl --head --user podcast "$base/Example%20Show"
curl --head --user podcast "$base/Example%20Show/episode/42"
curl --head --user podcast "$base/Example%20Show/rss"
curl --head --user podcast "$base/media/example.mp3"
curl --head --user podcast "$base/images/example.jpeg"
```

Existing resources should return `200`; RSS should have
`Content-Type: application/rss+xml`. A `404` after valid authentication can
mean the placeholder does not identify an existing resource; use real paths
before concluding the application is broken. Test playback/download and feed
refresh in the actual podcast client too.

For a real existing certificate challenge file, an unauthenticated request to
`/.well-known/acme-challenge/<token>` should serve it without a password prompt.
A missing challenge file can follow the `/index.html` fallback and be challenged.
Finally, verify that public access to the upstream port is blocked as described
above.
