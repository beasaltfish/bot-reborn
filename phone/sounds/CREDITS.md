# Sounds

All four are CC0 (public domain) from Freesound: no attribution is required,
and it is given anyway. Each is Freesound's high-quality MP3 preview, cut to
at most one second with a 100 ms fade-out, mixed to mono, and gain-matched
to a mean of about −18 dBFS so no sound is much louder than another.
Reflex spec §5.

| File | Source | Author | Licence |
|---|---|---|---|
| bark.mp3 | [Small Dog Bark](https://freesound.org/people/SecureSubset/sounds/800278/) | SecureSubset | CC0 |
| yip.mp3 | [82-PerritoGimoteaFeliz](https://freesound.org/people/Caap/sounds/427127/) | Caap | CC0 |
| whimper.mp3 | [Chihuahua Puppy Whine](https://freesound.org/people/AustinXYZ/sounds/350593/) | AustinXYZ | CC0 |
| growl.mp3 | [Low dog growl](https://freesound.org/people/randbsoundbites/sounds/829986/) | randbsoundbites | CC0 |

Replacing one: keep the name, keep it under a second (the move queued behind
a sound waits for it to end), and re-match the level:

```sh
ffmpeg -i <source> -ac 1 -ar 44100 -t 1.0 \
  -af "volume=<gain>dB,afade=t=out:st=0.9:d=0.1" -b:a 96k web/sounds/<name>.mp3
```
