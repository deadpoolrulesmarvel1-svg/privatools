#!/usr/bin/env bash
# Regenerates the synthetic media in this folder: two seconds of a 440 Hz
# tone, with a 32x32 test-pattern video where the container carries one, in
# each layout the Subtitle Generator's container readers handle, and seven
# seconds of synthetic speech for Voice Noise Remover. No real recordings.
# Needs ffmpeg with libx264, libvpx, libopus, libvorbis, libmp3lame and
# flite; run from anywhere.
set -euo pipefail
cd "$(dirname "$0")"
q() { ffmpeg -hide_banner -loglevel error -y "$@"; }
video=(-f lavfi -i "testsrc2=size=32x32:rate=2:duration=2")
tone() { echo -f lavfi -i "sine=frequency=440:sample_rate=$1:duration=2"; }
meta=(-map_metadata -1 -fflags +bitexact -flags:v +bitexact -flags:a +bitexact)

q "${video[@]}" $(tone 44100) -map 0:v -map 1:a -c:v libx264 -preset ultrafast -c:a aac -b:a 48k -ac 2 -shortest -movflags +faststart "${meta[@]}" tone.mp4
q "${video[@]}" $(tone 44100) -map 0:v -map 1:a -c:v libx264 -preset ultrafast -c:a aac -b:a 48k -ac 2 -shortest "${meta[@]}" tone-moov-last.mp4
q "${video[@]}" $(tone 48000) -map 0:v -map 1:a -c:v libx264 -preset ultrafast -c:a aac -b:a 48k -ac 2 -shortest "${meta[@]}" tone.mov
q "${video[@]}" $(tone 44100) -map 0:v -map 1:a -c:v libx264 -preset ultrafast -c:a aac -b:a 48k -shortest -movflags frag_keyframe+empty_moov "${meta[@]}" tone-fragmented.mp4
q "${video[@]}" -c:v libx264 -preset ultrafast "${meta[@]}" no-sound.mp4
q "${video[@]}" -c:v libvpx-vp9 -deadline realtime -cpu-used 8 "${meta[@]}" no-sound.webm
q $(tone 16000) -c:a aac -b:a 32k "${meta[@]}" tone.m4a
q $(tone 44100) -c:a libmp3lame -b:a 64k -ac 1 -f mp4 "${meta[@]}" tone-mp3-in.mp4
q "${video[@]}" $(tone 48000) -map 0:v -map 1:a -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -c:a libopus -b:a 32k -shortest "${meta[@]}" tone.webm
q "${video[@]}" $(tone 44100) -map 0:v -map 1:a -c:v libvpx -deadline realtime -cpu-used 8 -c:a libvorbis -shortest "${meta[@]}" tone-vorbis.webm
q "${video[@]}" $(tone 48000) -map 0:v -map 1:a -c:v libx264 -preset ultrafast -c:a aac -b:a 48k -shortest "${meta[@]}" tone.mkv
q $(tone 44100) -c:a libmp3lame -b:a 64k -ac 1 "${meta[@]}" tone.mp3
q $(tone 8000) -c:a pcm_s16le "${meta[@]}" tone.wav
# flite's own synthetic voice, so the noise tests hear speech that is nobody's recording.
q -f lavfi -i "flite=text='Every recording carries a little noise. A fan hums, and traffic passes outside. A computer made this voice.':voice=slt" -ar 16000 -ac 1 -c:a pcm_s16le "${meta[@]}" speech.wav
ls -l
