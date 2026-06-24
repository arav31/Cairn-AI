import {createWriteStream, existsSync, mkdirSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {pipeline} from "node:stream/promises";
import {Readable} from "node:stream";

const root = process.cwd();

const assets = [
  {
    file: "public/assets/stock/analytics-laptop.mp4",
    url: "https://videos.pexels.com/video-files/8480289/8480289-hd_1920_1080_25fps.mp4",
    source: "https://www.pexels.com/video/a-man-using-a-laptop-8480289/",
    credit: "Pexels video 8480289",
  },
  {
    file: "public/assets/stock/code-laptop.mp4",
    url: "https://videos.pexels.com/video-files/13522186/13522186-hd_1920_1080_25fps.mp4",
    source: "https://www.pexels.com/video/a-programmer-working-on-a-laptop-computer-13522186/",
    credit: "Pexels video 13522186 by Raddy",
  },
  {
    file: "public/assets/stock/private-team.mp4",
    url: "https://videos.pexels.com/video-files/7989451/7989451-hd_1920_1080_25fps.mp4",
    source: "https://www.pexels.com/video/team-are-working-using-their-laptop-7989451/",
    credit: "Pexels video 7989451 by Mikhail Nilov",
  },
  {
    file: "public/assets/stock/server-room.mp4",
    url: "https://videos.pexels.com/video-files/1085656/1085656-hd_1920_1080_25fps.mp4",
    source: "https://www.pexels.com/video/blue-colored-cables-1085656/",
    credit: "Pexels video 1085656",
  },
];

const download = async (asset) => {
  const target = join(root, asset.file);
  mkdirSync(dirname(target), {recursive: true});
  if (existsSync(target)) {
    console.log(`exists ${asset.file}`);
    return;
  }
  const response = await fetch(asset.url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${asset.file}: ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
  console.log(`wrote ${asset.file}`);
};

for (const asset of assets) {
  await download(asset);
}

writeFileSync(
  join(root, "public/assets/stock/asset-sources.json"),
  `${JSON.stringify(
    {
      license: "Pexels free-use license. Attribution is not required but appreciated.",
      licenseUrl: "https://www.pexels.com/license/",
      assets: assets.map(({file, source, credit}) => ({file, source, credit})),
    },
    null,
    2,
  )}\n`,
);
