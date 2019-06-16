# Majorpodo
> A podcast server that uses metadata from static audio files

Given a directory, Majorpodo will serve the audio files it finds there over HTTP
along with webpages and RSS feeds generated from the metadata inside those
files.

Use it to host your own podcast, or provide a means to get files [downloaded
from BBC radio](https://github.com/get-iplayer/get_iplayer) into your podcast
client for convenient personal use (Majorpodo supports password protection).

## Installation

1. Checkout the project from Github
2. `npm install`

## Configuration

Majorpodo uses [config](https://www.npmjs.com/package/config) for configuration.
You will find an example configuration file in `config/dev.yml`. You will
probably want to create a `config/default.yml` (or `.json` etc).

To run with the development configuration:

    NODE_ENV=dev node index.js

## Meta

David Dorward – [@dorward](https://twitter.com/dorward) – david@dorward.me.uk

Distributed under the [GNU General Public License version 2](https://opensource.org/licenses/GPL-2.0).

[https://github.com/dorward/](https://github.com/dorward/)

## Contributing

1. Fork it (<https://github.com/dorward/majorpodo/fork>)
2. Create your feature branch (`git checkout -b feature/fooBar`)
3. Commit your changes (`git commit -am 'Add some fooBar'`)
4. Push to the branch (`git push origin feature/fooBar`)
5. Create a new Pull Request

