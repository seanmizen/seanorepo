# REQ-RENDER — The depth buffer and z-fighting

The renderer of `action` (`apps/action/game/src/render.zig`,
`scene.wgsl`) and the static mesh of its maps. Two surfaces at the same
depth z-fight: the screen shows stripes of both, and the stripes move with
the camera.

---

## REQ-RENDER-001 — The camera uses reversed Z

- **Status:** active
- **Source:** agent:SEAN-911
- **Origin:** #911
- **Type:** quality
- **Priority:** P1
- **Statement:** The action renderer shall map the near plane of the camera
  to depth 1 and the far plane of the camera to depth 0.
- **Rationale:** A float depth buffer with standard Z has most of its
  precision near the camera. At 100 m one depth step was about 16 mm, so
  decoration 2 mm to 8 mm from a face z-fought from about 35 m. With
  reversed Z one step at 100 m is less than 0.01 mm. The depth target clears
  to 0, and each pipeline that tests it keeps the greater depth.
- **Verification:** Test — `apps/action/game/src/vec.zig` › "reversed perspective: the near plane is depth 1, the far plane depth 0 (REQ-RENDER-001)"
- **Relations:** none

## REQ-RENDER-002 — A map has no coplanar overlap

- **Status:** active
- **Source:** agent:SEAN-911
- **Origin:** #911
- **Type:** quality
- **Priority:** P1
- **Statement:** Each action map shall contain no coplanar overlap in its
  static mesh: two faces that face the same way, are less than 1.5 mm apart,
  overlap by 1 cm² or more, have a different colour or material, and show.
- **Rationale:** Reversed Z does not separate two faces at the same depth.
  The audit (`apps/action/game/src/coplanar.zig`) finds them. A fix moves
  one face 1 cm or more, or cuts the lower face.
- **Verification:** Test — `apps/action/game/src/surfaces_test.zig` › "no map has a coplanar overlap: two faces that z-fight (REQ-RENDER-002)"
- **Relations:** none
