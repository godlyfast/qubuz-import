#!/usr/bin/env node

const Qobuz = require("qobuz");
const http = require("http");
const https = require("https");
const rimraf = require("rimraf");

const fs = require("fs");
const flac = require("flac-metadata");
const vendor = "reference libFLAC 1.2.1 20070917";

const handler = albumId =>
  new Promise(async (resolve, reject) => {
    if (!albumId) return reject(new Error("Album ID should be specified"));
    if (!process.env.QOBUZ_CLIENT_ID)
      return reject(
        new Error("QOBUZ_CLIENT_ID should be specified in .env file")
      );
    if (!process.env.QOBUZ_CLIENT_SECRET)
      return reject(
        new Error("QOBUZ_CLIENT_SECRET should be specified in .env file")
      );
    if (!process.env.QOBUZ_USER_LOGIN)
      return reject(
        new Error("QOBUZ_USER_LOGIN should be specified in .env file")
      );
    if (!process.env.QOBUZ_USER_PASSWORD)
      return reject(
        new Error("QOBUZ_USER_PASSWORD should be specified in .env file")
      );

    const client = new Qobuz(
      process.env.QOBUZ_CLIENT_ID,
      process.env.QOBUZ_CLIENT_SECRET
    );
    try {
      const user = await client.user.login(
        process.env.QOBUZ_USER_LOGIN,
        process.env.QOBUZ_USER_PASSWORD
      );
      const album = await client.album.get(albumId);

      await new Promise((res, rej) =>
        rimraf(`downloads/${album.slug}`, () => res())
      );

      if (!fs.existsSync(`downloads/${album.slug}`)) {
        fs.mkdirSync(`downloads/${album.slug}`);
      }

      await new Promise((res, rej) =>
        https.get(album.image.large, resp =>
          resp
            .pipe(fs.createWriteStream(`downloads/${album.slug}/picture.jpg`))
            .on("finish", () => res())
            .on("error", err => rej(err))
        )
      );

      const pic = fs.readFileSync(
        `downloads/${album.slug}/picture.jpg`,
        "base64"
      );

      const picBuff = Buffer.alloc(pic.length, pic, "base64");

      const downloadTrack = async track => {
        //userAuthToken, trackId, formatId, intent
        const dfu = await client.track.getFileUrl(
          user.user_auth_token,
          track.id,
          "27",
          "import"
        );

        const processor = new flac.Processor();
        let mdbVorbis;
        let mdbPicture;
        const comments = [
          `ARTIST=${album.artist.name}`,
          `TITLE=${track.title}`,
          `ALBUM=${album.title}`,
          `TRACKNUMBER=${track.track_number}`,
          `DATE=${new Date(album.released_at).getFullYear()}`,
          `GENRE=${album.genre.name}`
          // `METADATA_BLOCK_PICTURE=${pic}`
        ];

        processor.on("preprocess", function(mdb) {
          // Remove existing VORBIS_COMMENT block, if any.
          if (mdb.type === flac.Processor.MDB_TYPE_VORBIS_COMMENT) {
            mdb.remove();
          }

          if (mdb.type === flac.Processor.MDB_TYPE_PICTURE) {
            mdb.remove();
          }
          // Prepare to add new VORBIS_COMMENT block as last metadata block.

          if (mdb.isLast) {
            mdb.isLast = false;
            mdbVorbis = flac.data.MetaDataBlockVorbisComment.create(
              false,
              vendor,
              comments
            );

            mdbPicture = flac.data.MetaDataBlockPicture.create(
              // isLast, pictureType, mimeType, description,
              // width, height, bitsPerPixel, colors, pictureData
              true,
              3,
              "image/jpeg",
              "",
              600,
              600,
              32,
              0,
              picBuff
            );
          }
        });

        processor.on("postprocess", function(mdb) {
          if (mdbVorbis) {
            // Add new VORBIS_COMMENT block as last metadata block.
            this.push(mdbVorbis.publish());
          }
          if (mdbPicture) {
            this.push(mdbPicture.publish());
          }
        });

        await new Promise((resolve, reject) =>
          http.get(dfu.url, response =>
            response
              .pipe(processor)
              .pipe(
                fs.createWriteStream(
                  `downloads/${album.slug}/${dfu.track_id}.flac`
                )
              )
              .on("finish", resolve)
              .on("error", reject)
          )
        );
      };

      const result = await Promise.all(
        [album.tracks.items[0], album.tracks.items[1]].map(i =>
          downloadTrack(i)
        )
      );
      console.log(result)
    } catch (e) {
      reject(e);
    }
  });

require("dotenv").config();

handler(process.argv[2]).catch(err => {
  console.log("Error: " + err.message);
});
