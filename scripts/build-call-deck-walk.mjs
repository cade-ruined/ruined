#!/usr/bin/env node

// Rebuild only the call deck's eight landscape walk clips. The homepage's
// source frames remain untouched. Run: node scripts/build-call-deck-walk.mjs
// Optional executable overrides: FFMPEG_BIN and FFPROBE_BIN.
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rename, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(path.join(root, "src/data/sequence-config.json"), "utf8"));
const output = path.join(root, "public/media/call-deck");
const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg";
const ffprobe = process.env.FFPROBE_BIN || "ffprobe";
const fps = 30;
const duration = 1.6;
const frameTotal = Math.round(fps * duration);
const size = { width: 1440, height: 810 };

function framePath(room, number) {
  return path.join(root, "public/sequences", room, `frame-${String(number).padStart(4, "0")}.webp`);
}

// These are the canonical MOBILE_ARRIVAL_FRAME_PATHS from mobileJourney.ts:
// each room's opening frame, then the lounge's final frame for fireside.
const arrivals = config.rooms.map((room) => framePath(room.id, 1));
const finalRoom = config.rooms.at(-1);
arrivals.push(framePath(finalRoom.id, finalRoom.frameCount));

const walks = config.rooms.map((room, roomIndex) => {
  const frames = Array.from({ length: frameTotal }, (_, index) => {
    if (index === 0) return arrivals[roomIndex];
    if (index === frameTotal - 1) return arrivals[roomIndex + 1];
    const sourceNumber = Math.round(index * (room.frameCount - 1) / (frameTotal - 1)) + 1;
    return framePath(room.id, sourceNumber);
  });
  return { room: room.id, frames };
});

// Validate sources and binaries before changing any generated output.
await Promise.all([...new Set(walks.flatMap((walk) => walk.frames))].map((source) => access(source)));
await Promise.all([run(ffmpeg, ["-version"]), run(ffprobe, ["-version"])]);
await mkdir(output, { recursive: true });
const working = await mkdtemp(path.join(tmpdir(), "ruined-call-deck-walk-"));
const report = [];

try {
  for (const walk of walks) {
    for (const direction of ["forward", "reverse"]) {
      const clipName = `${walk.room}-${direction}.mp4`;
      const frameDirectory = path.join(working, `${walk.room}-${direction}`);
      await mkdir(frameDirectory);
      const frames = direction === "forward" ? walk.frames : [...walk.frames].reverse();
      await Promise.all(frames.map((source, index) => symlink(
        source,
        path.join(frameDirectory, `frame-${String(index).padStart(3, "0")}.webp`),
      )));
      const temporaryOutput = path.join(output, `.${walk.room}-${direction}.tmp.mp4`);
      try {
        await run(ffmpeg, [
          "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
          "-framerate", String(fps), "-start_number", "0",
          "-i", path.join(frameDirectory, "frame-%03d.webp"),
          "-frames:v", String(frameTotal),
          "-vf", `scale=${size.width}:${size.height}:flags=lanczos:out_color_matrix=bt709,setsar=1`,
          "-c:v", "libx264", "-preset", "medium", "-crf", "22",
          "-pix_fmt", "yuv420p", "-threads", "2", "-an",
          "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
          "-fps_mode", "cfr", "-movflags", "+faststart", "-map_metadata", "-1",
          temporaryOutput,
        ], { maxBuffer: 2 * 1024 * 1024 });
        const { stdout } = await run(ffprobe, [
          "-v", "error", "-show_entries",
          "stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,nb_frames:format=duration,size",
          "-of", "json", temporaryOutput,
        ]);
        const result = JSON.parse(stdout);
        const video = result.streams.find((stream) => stream.codec_type === "video");
        if (result.streams.length !== 1 || video?.codec_name !== "h264" ||
            video.width !== size.width || video.height !== size.height ||
            video.pix_fmt !== "yuv420p" || video.avg_frame_rate !== `${fps}/1` ||
            Number(video.nb_frames) !== frameTotal ||
            Math.abs(Number(result.format.duration) - duration) > 0.001) {
          throw new Error(`Unexpected output format for ${clipName}: ${stdout}`);
        }
        const finalOutput = path.join(output, clipName);
        await rename(temporaryOutput, finalOutput);
        const { size: bytes } = await stat(finalOutput);
        report.push({ file: clipName, duration, frames: frameTotal, bytes });
        console.log(`${clipName}: ${duration}s, ${frameTotal} frames, ${(bytes / 1024).toFixed(1)} KiB`);
      } finally {
        await rm(temporaryOutput, { force: true });
      }
    }
  }
  const total = report.reduce((sum, clip) => sum + clip.bytes, 0);
  console.log(`Verified ${report.length} silent H.264 clips at ${size.width}x${size.height}, ${fps} fps; ${(total / 1024 / 1024).toFixed(2)} MiB total.`);
} finally {
  await rm(working, { recursive: true, force: true });
}
