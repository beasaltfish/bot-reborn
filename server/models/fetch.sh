#!/bin/sh
# The two models the brain listens with. Same KWS model and VAD as the phone
# build (docs/hardware.md ⑤), as plain ONNX files instead of a wasm bundle.
set -eu
cd "$(dirname "$0")"
KWS=sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20
curl -L -o kws.tar.bz2 "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/$KWS.tar.bz2"
tar xjf kws.tar.bz2
for f in encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx \
         decoder-epoch-13-avg-2-chunk-16-left-64.onnx \
         joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx \
         tokens.txt; do
  cp "$KWS/$f" .
done
rm -rf "$KWS" kws.tar.bz2
curl -L -o silero_vad.onnx https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx
echo "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6  silero_vad.onnx" | shasum -a 256 -c
