// Where: run on a Mac (macOS 14 or later). It uses the Vision framework.
// When: you add a photo of Cous to the game.
// Why: Vision lifts the subject out of the photo, as Photos does. The
//      result is a PNG with a transparent background that is cropped to
//      the subject. Then resize it to 4 image px per logical px and add
//      it to the cous theme (src/cous/sprites.ts).
//
// Usage: swift scripts/lift.swift <photo> <out.png>

import CoreImage
import Vision

let args = CommandLine.arguments
guard args.count == 3 else {
  print("Usage: swift scripts/lift.swift <photo> <out.png>")
  exit(1)
}
let input = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2])

guard
  let image = CIImage(contentsOf: input, options: [.applyOrientationProperty: true])
else {
  print("Cannot read \(input.path).")
  exit(1)
}
let handler = VNImageRequestHandler(ciImage: image)
let request = VNGenerateForegroundInstanceMaskRequest()
try handler.perform([request])
guard let result = request.results?.first else {
  print("Vision found no subject in \(input.path).")
  exit(1)
}
let buffer = try result.generateMaskedImage(
  ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: true)
try CIContext().writePNGRepresentation(
  of: CIImage(cvPixelBuffer: buffer), to: output, format: .RGBA8,
  colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
