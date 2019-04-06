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

      //await new Promise((res, rej) =>
      //  rimraf(`downloads/${album.slug}`, () => res())
      //);

      if (!fs.existsSync(__dirname + `/downloads/${album.slug}`)) {
        fs.mkdirSync(__dirname + `/downloads/${album.slug}`);
      }

      await new Promise((res, rej) =>
        https.get(album.image.large, resp =>
          resp
            .pipe(
              fs.createWriteStream(
                __dirname + `/downloads/${album.slug}/picture.jpg`
              )
            )
            .on("finish", () => res())
            .on("error", err => rej(err))
        )
      );

      const pic = fs.readFileSync(
        __dirname + `/downloads/${album.slug}/picture.jpg`,
        "base64"
      );

      const picBuff = Buffer.alloc(pic.length, pic, "base64");

      const pushTags = track =>
        new Promise(async (resolve, reject) => {
          const processor = new flac.Processor();
          let mdbVorbis;
          let mdbPicture;
          let vobPushed, picPushed;
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
              // console.log("PUSHING VOB", track.title);
              // Add new VORBIS_COMMENT block as last metadata block.
              this.push(mdbVorbis.publish());
              vobPushed = true;
            }
            if (mdbPicture) {
              // console.log("PUSHING PIC", track.title);

              this.push(mdbPicture.publish());
              picPushed = true;
            }
          });
          await new Promise((resolve, reject) =>
            fs
              .createReadStream(
                __dirname + `/downloads/${album.slug}/${track.id}.flac`
              )
              .pipe(processor)
              .pipe(
                fs.createWriteStream(
                  __dirname + `/downloads/${album.slug}/${track.id}_.flac`
                )
              )
              .on("finish", () => {
                if (vobPushed && picPushed) {
                  resolve(`${track.id} ${track.title} tagged`);
                } else {
                  Promise.all(
                    [
                      new Promise((resolve, reject) =>
                        fs.unlink(
                          __dirname +
                            `/downloads/${album.slug}/${track.id}.flac`,
                          err => {
                            if (err) return reject(err);
                            resolve(`REMOVED ${track.title}`);
                          }
                        )
                      ),
                      new Promise((resolve, reject) =>
                        fs.unlink(
                          __dirname +
                            `/downloads/${album.slug}/${track.id}_.flac`,
                          err => {
                            if (err) return reject(err);
                            resolve(`REMOVED ${track.title}_`);
                          }
                        )
                      )
                    ],
                    () => resolve(new Error(`${track.title} Download Failed`))
                  );
                }
              })
              .on("error", reject)
          );

          fs.unlink(
            __dirname + `/downloads/${album.slug}/${track.id}.flac`,
            err => {
              if (err) return reject(err);
              resolve(`TAGGED ${track.title}`);
            }
          );
        });

      const downloadTrack = async track => {
        console.log("DL STARING", track.title);
        //userAuthToken, trackId, formatId, intent
        const dfu = await client.track.getFileUrl(
          user.user_auth_token,
          track.id,
          "27",
          "import"
        );

        await new Promise((resolve, reject) =>
          http.get(dfu.url, response =>
            response
              .pipe(
                fs.createWriteStream(
                  __dirname + `/downloads/${album.slug}/${dfu.track_id}.flac`
                )
              )
              .on("finish", resolve)
              .on("error", reject)
          )
        );
        console.log("DL FINISHED", track.title);
      };

      const result = await Promise.all(
        album.tracks.items.map(
          i =>
            new Promise(async (res, rej) => {
              try {
                if (
                  fs.existsSync(
                    __dirname + `/downloads/${album.slug}/${i.track_id}_.flac`
                  )
                ) {
                  console.log("File exists", stat);
                  res(`${i.title} exists`);
                } else {
                  await downloadTrack(i);
                  await pushTags(i);
                  res(`${i.title} success`);
                }
              } catch (e) {
                console.log("ERROR, ", e);
                rej(e);
              }
            })
        )
      );
      console.log(album.slug, result);
    } catch (e) {
      reject(e);
    }
  });

require("dotenv").config();
handler(
  process.argv[2].indexOf("https") > -1
    ? process.argv[2].split("/").pop()
    : process.argv[2]
).catch(err => {
  console.log("Error: " + err.message);
  process.exit();
});
