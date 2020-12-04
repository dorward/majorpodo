# Setup Instructions for Majorpodo

## Directories

### Application

At present Majorpodo expects to be run from the directory it was checked out
into. Future releases may expect to be installed on the system PATH.

I create a dedicated user to run majorpodo, install Node.js via
[`nvm`](https://github.com/nvm-sh/nvm), and check out the project to
`/home/majorpodo/majorpodo/`.

### Data

You need to create a directory to store your audio files. I use
`/var/media/audio/`. Make sure you give permission for the user majorpodo runs
as to read the directory and that you specify that path in the configuration
file under `path`.

### Thumbnails

Majorpodo extracts thumbnail images from media files to use in its preview
webpages. It needs a directory to store them in, I use
`/var/majorpodo/thumbnail_cache/`. Make sure you give permission for the user
majorpodo runs as to read and _write_ to the directory and that you specify that
path in the configuration file under `imagePath`.

#### Overriding thumbnails

You can override the thumbnail extracted from the media file by creating an
image with the same name, but with a `.jpg` extension, as the audio file in the
**same directory as the audio file**.

e.g. Given `/var/media/majorpodo/myPodcast.s01e01.Introduction.m4a`:

A _generated_ thumbnail would be placed in
`/var/majorpodo/thumbnail_cache/myPodcast.s01e01.Introduction.jpg` while a
manual override should be placed in
`/var/media/majorpodo/myPodcast.s01e01.Introduction.jpg`.

## Configuration files

Majorpodo uses the [config module](https://www.npmjs.com/package/config) for
configuration. You will find an example configuration file in
`config/sample.yml`. You will probably want to copy it to `config/default.yml`
(or `.json` etc) and then edit it following the comments in the file.

Your configuration file should be placed in the `config` directory in the
project directory.

The `default.yml` file will be read first. If the `NODE_ENV` environment
variable is set, the file `$NODE_ENV.yml` will also be parsed and any entries in
it will override those in `default.yml`.

To run with the sample configuration:

    NODE_ENV=sample node index.js

## Process Management

It is recommended to run Majorpodo using [pm2](https://pm2.keymetrics.io/).
These commands install pm2 and it's logrotate module, configure log rotation and
will run majorpodo at startup.

    npm install pm2@latest -g
    pm2 install pm2-logrotate
    pm2 startup  # You will be instructed to run a command to configure a startup service
    pm2 start index.js --name majorpodo
    pm2 save

To see running processes:

    pm2 list

## Proxy Server

I use nginx as a proxy server in front of my majorpodo process.

A sample file based on my settings follows. Key points to note are:

- The `proxy_pass` directive so it serves up content from Majorpodo
- The SSL configuration so this isn't hosted unencrypted
- The [`auth_basic` directives](https://docs.nginx.com/nginx/admin-guide/security-controls/configuring-http-basic-authentication/) so that access is restricted to people with credentials.

You may with to omit some of these.

```
server {
    listen 443 ssl;
    root /var/www/;
    index index.html index.htm index.nginx-debian.html;
    server_name majorpodo.example.com;
    location / {
            proxy_pass           http://localhost:3000/;
            auth_basic           "Majorpodo";
            auth_basic_user_file /etc/majorpodo/htpasswd;
    }
    ssl_certificate /etc/letsencrypt/live/majorpodo.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/majorpodo.example.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}
```
