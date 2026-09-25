//! Block models: blocks that aren't full cubes (torches, slabs, stairs, beds), as boxes on a
//! 1/16 grid, Minecraft style.
//!
//! Each variant's model is built once from its `ModelKind`: written facing north, then turned
//! to its facing. Textures are mapped from world position (the part of the texture under each
//! face), so a half slab shows the lower half of its texture; a face that has to show its
//! texture a particular way round (a bed's pillow toward its head) says which way its image's
//! right and up point, and turning the model turns those with it (see `uv_transform`).
//!
//! A model gives:
//! - `parts`: the boxes drawn, a texture per face;
//! - `bounds`: the boxes you collide with (if the block is solid) and aim at;
//! - `cover`: which parts of each of the cell's six sides it fills with opaque faces, as a 4x4
//!   grid, so a neighbour's face against a filled side isn't drawn.

use std::sync::OnceLock;

use crate::blocks::*;

/// A box face that isn't drawn.
pub const NO_TEX: u16 = u16::MAX;
/// Every cell of the 4x4 side grid: a full side.
pub const FULL_SIDE: u16 = 0xffff;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BoxFace {
    pub tex: u16,
    /// `UV_*` bits.
    pub uvt: u8,
}

#[derive(Clone, Copy, Debug)]
pub struct Cuboid {
    /// Corners in 1/16 of a block, 0..=16, cell-local.
    pub from: [u8; 3],
    pub to: [u8; 3],
    /// +X -X +Y -Y +Z -Z.
    pub faces: [BoxFace; 6],
}

pub struct Model {
    pub parts: Vec<Cuboid>,
    /// [x0, y0, z0, x1, y1, z1] in 1/16 of a block.
    pub bounds: Vec<[u8; 6]>,
    /// Per side of the cell (+X -X +Y -Y +Z -Z), the 4x4 grid of it filled (see `side_mask`).
    pub cover: [u16; 6],
    /// Lit evenly by its own cell (small things: torches), rather than smoothly like a cube face.
    pub flat_light: bool,
}

pub struct Shapes {
    /// By block id; None for blocks that aren't models.
    pub models: Vec<Option<Model>>,
    /// By block id, per side (+X -X +Y -Y +Z -Z): the 4x4 grid of that side the block fills
    /// with an opaque face. Full cubes fill everything.
    pub cover: [[u16; 6]; 256],
}

pub fn shapes() -> &'static Shapes {
    static SHAPES: OnceLock<Shapes> = OnceLock::new();
    SHAPES.get_or_init(build)
}

/// The face opposite each face.
pub const OPPOSITE: [usize; 6] = [1, 0, 3, 2, 5, 4];

const NORMALS: [[i32; 3]; 6] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/// How the shaders map a face's texture from world position: the directions of increasing u
/// and of the image's up (see `vertex_unpack.glsl`).
const FACE_U: [[i32; 3]; 6] = [[0, 0, -1], [0, 0, 1], [1, 0, 0], [1, 0, 0], [1, 0, 0], [-1, 0, 0]];
const FACE_V: [[i32; 3]; 6] = [[0, 1, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, 1, 0]];

fn neg(a: [i32; 3]) -> [i32; 3] {
    [-a[0], -a[1], -a[2]]
}

fn face_of(n: [i32; 3]) -> usize {
    NORMALS.iter().position(|&m| m == n).expect("axis-aligned normal")
}

/// The texture transform (`UV_*` bits) that shows a face's image with its right toward `u` and
/// its up toward `v`.
pub fn uv_transform(face: usize, u: [i32; 3], v: [i32; 3]) -> u8 {
    for t in 0..8u8 {
        let (mut a, mut b) = if t & UV_SWAP != 0 { (FACE_V[face], FACE_U[face]) } else { (FACE_U[face], FACE_V[face]) };
        if t & UV_NEG_U != 0 {
            a = neg(a);
        }
        if t & UV_NEG_V != 0 {
            b = neg(b);
        }
        if a == u && b == v {
            return t;
        }
    }
    panic!("image axes {u:?} {v:?} don't lie in face {face}");
}

/// A face while a model is being built: its texture and which way its image faces.
#[derive(Clone, Copy)]
struct ProtoFace {
    tex: u16,
    u: [i32; 3],
    v: [i32; 3],
}

#[derive(Clone, Copy)]
struct Proto {
    from: [i32; 3],
    to: [i32; 3],
    faces: [ProtoFace; 6],
}

impl Proto {
    /// A box with every face showing `tex` the default way round.
    fn new(from: [i32; 3], to: [i32; 3], tex: u16) -> Proto {
        let faces = std::array::from_fn(|f| ProtoFace { tex, u: FACE_U[f], v: FACE_V[f] });
        Proto { from, to, faces }
    }

    fn face(mut self, f: usize, tex: u16) -> Proto {
        self.faces[f].tex = tex;
        self
    }

    /// Show face `f`'s image with its right toward `u` and its up toward `v`.
    fn orient(mut self, f: usize, u: [i32; 3], v: [i32; 3]) -> Proto {
        self.faces[f].u = u;
        self.faces[f].v = v;
        self
    }

    /// A quarter turn clockwise seen from above (north to east), about the cell's centre.
    fn turn(self) -> Proto {
        let p = |a: [i32; 3]| [16 - a[2], a[1], a[0]];
        let d = |a: [i32; 3]| [-a[2], a[1], a[0]];
        let (a, b) = (p(self.from), p(self.to));
        let from = [a[0].min(b[0]), a[1].min(b[1]), a[2].min(b[2])];
        let to = [a[0].max(b[0]), a[1].max(b[1]), a[2].max(b[2])];
        let mut faces = self.faces;
        for f in 0..6 {
            let g = face_of(d(NORMALS[f]));
            faces[g] = ProtoFace { tex: self.faces[f].tex, u: d(self.faces[f].u), v: d(self.faces[f].v) };
        }
        Proto { from, to, faces }
    }

    fn turned(mut self, quarters: u8) -> Proto {
        for _ in 0..quarters {
            self = self.turn();
        }
        self
    }

    fn cuboid(&self) -> Cuboid {
        let c = |a: [i32; 3]| [a[0] as u8, a[1] as u8, a[2] as u8];
        let faces = std::array::from_fn(|f| {
            let pf = self.faces[f];
            BoxFace { tex: pf.tex, uvt: if pf.tex == NO_TEX { 0 } else { uv_transform(f, pf.u, pf.v) } }
        });
        Cuboid { from: c(self.from), to: c(self.to), faces }
    }
}

fn bound(p: &Proto) -> [u8; 6] {
    [p.from[0] as u8, p.from[1] as u8, p.from[2] as u8, p.to[0] as u8, p.to[1] as u8, p.to[2] as u8]
}

/// A box given as corners (1/16), turned to `facing`.
fn turned_box(from: [i32; 3], to: [i32; 3], facing: u8) -> [u8; 6] {
    bound(&Proto::new(from, to, 0).turned(facing))
}

/// Give each face of a material model (slab, stairs) the block's texture for that direction.
fn material(mut p: Proto, b: &Block) -> Proto {
    for f in 0..6 {
        p.faces[f] = ProtoFace { tex: b.tex[f], u: FACE_U[f], v: FACE_V[f] };
    }
    p
}

fn model_of(b: &Block) -> Option<Model> {
    let (parts, bounds, flat_light): (Vec<Proto>, Vec<[u8; 6]>, bool) = match b.model {
        ModelKind::None => return None,
        ModelKind::Torch => {
            let stick = Proto::new([7, 0, 7], [9, 10, 9], b.tex[0]).face(3, b.tex[3]);
            (vec![stick], vec![[6, 0, 6, 10, 10, 10]], true)
        }
        ModelKind::WallTorch(facing) => {
            // Upright against the wall behind it (south, facing north). The wall torch texture
            // has the stick at every column pair these faces show (see `texgen::wall_torch`).
            let stick = Proto::new([7, 3, 14], [9, 13, 16], b.tex[0]).face(3, b.tex[3]).turned(facing);
            (vec![stick], vec![turned_box([5, 3, 11], [11, 13, 16], facing)], true)
        }
        ModelKind::Slab(top) => {
            let (y0, y1) = if top { (8, 16) } else { (0, 8) };
            let p = material(Proto::new([0, y0, 0], [16, y1, 16], 0), b);
            let bx = bound(&p);
            (vec![p], vec![bx], false)
        }
        ModelKind::Stairs(facing, top) => {
            // A half slab, and a step on its north half the other side of it.
            let (slab, step) = if top { ((8, 16), (0, 8)) } else { ((0, 8), (8, 16)) };
            let a = Proto::new([0, slab.0, 0], [16, slab.1, 16], 0).turned(facing);
            let s = Proto::new([0, step.0, 0], [16, step.1, 8], 0).turned(facing);
            let (a, s) = (material(a, b), material(s, b));
            let bounds = vec![bound(&a), bound(&s)];
            (vec![a, s], bounds, false)
        }
        ModelKind::Bed(facing, head) => {
            // Facing north: the head half is the northern one. A mattress 3..9 high on four legs.
            let [top, side, end, under, legs, _] = b.tex;
            let toward_head = [0, 0, -1];
            let up = [0, 1, 0];
            let (outer_end, inner_end) = if head { (5, 4) } else { (4, 5) };
            let mattress = Proto::new([0, 3, 0], [16, 9, 16], side)
                .face(2, top)
                .orient(2, [1, 0, 0], toward_head)
                .face(3, under)
                .face(outer_end, end)
                .face(inner_end, NO_TEX)
                .orient(0, toward_head, up)
                .orient(1, toward_head, up);
            let (z0, z1) = if head { (0, 3) } else { (13, 16) };
            let leg = |x0: i32| Proto::new([x0, 0, z0], [x0 + 3, 3, z1], legs).face(2, NO_TEX);
            let parts: Vec<Proto> = [mattress, leg(0), leg(13)].into_iter().map(|p| p.turned(facing)).collect();
            (parts, vec![[0, 0, 0, 16, 9, 16]], false)
        }
    };
    let parts: Vec<Cuboid> = parts.iter().map(|p| p.cuboid()).collect();
    let mut cover = [0u16; 6];
    if b.layer == Layer::Opaque {
        for p in &parts {
            for f in 0..6 {
                if p.faces[f].tex != NO_TEX && on_side(p, f) {
                    cover[f] |= side_mask(p, f, true);
                }
            }
        }
    }
    Some(Model { parts, bounds, cover, flat_light })
}

/// Whether face `f` of a box lies on the cell's side `f`.
#[inline]
pub fn on_side(p: &Cuboid, f: usize) -> bool {
    match f {
        0 => p.to[0] == 16,
        1 => p.from[0] == 0,
        2 => p.to[1] == 16,
        3 => p.from[1] == 0,
        4 => p.to[2] == 16,
        _ => p.from[2] == 0,
    }
}

/// The cells of the 4x4 grid over a cell side (4/16 of a block each) that face `f` of a box
/// covers. `inner`: only cells it covers entirely (what it fills); otherwise every cell it
/// touches (what it needs filled to be hidden). The grid's axes are the side's (a, b): x/z on
/// ±X... see `side_axes`.
pub fn side_mask(p: &Cuboid, f: usize, inner: bool) -> u16 {
    let (a, b) = side_axes(f);
    let span = |lo: u8, hi: u8| -> (u32, u32) {
        if inner {
            ((lo as u32).div_ceil(4), hi as u32 / 4)
        } else {
            (lo as u32 / 4, (hi as u32).div_ceil(4))
        }
    };
    let (a0, a1) = span(p.from[a], p.to[a]);
    let (b0, b1) = span(p.from[b], p.to[b]);
    let mut m = 0u16;
    for j in b0..b1 {
        for i in a0..a1 {
            m |= 1 << (j * 4 + i);
        }
    }
    m
}

/// The two axes along a side of face `f`, in grid order (a, then b).
#[inline]
pub fn side_axes(f: usize) -> (usize, usize) {
    match f {
        0 | 1 => (2, 1),
        2 | 3 => (0, 2),
        _ => (0, 1),
    }
}

fn build() -> Shapes {
    let mut models = Vec::with_capacity(256);
    let mut cover = [[0u16; 6]; 256];
    for id in 0..256usize {
        let b = block(id as u8);
        let m = if id < BLOCK_COUNT { model_of(b) } else { None };
        cover[id] = match &m {
            Some(m) => m.cover,
            None if id >= BLOCK_COUNT || OPAQUE[id] == 1 => [FULL_SIDE; 6],
            None => [0; 6],
        };
        models.push(m);
    }
    Shapes { models, cover }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transforms_cover_every_orientation() {
        // Default axes need no transform; a bed's top shows its head end at the image's top.
        for f in 0..6 {
            assert_eq!(uv_transform(f, FACE_U[f], FACE_V[f]), 0);
        }
        assert_eq!(uv_transform(2, [1, 0, 0], [0, 0, -1]), UV_NEG_V);
    }

    #[test]
    fn slabs_and_stairs_fill_their_sides() {
        let s = shapes();
        let bottom = &s.models[slab_id(0, false) as usize].as_ref().unwrap();
        assert_eq!(bottom.cover[3], FULL_SIDE, "underside full");
        assert_eq!(bottom.cover[2], 0, "top open");
        assert_eq!(bottom.cover[0], 0x00ff, "lower half of each side");
        let stairs = &s.models[stairs_id(0, NORTH_F, false) as usize].as_ref().unwrap();
        assert_eq!(stairs.cover[5], FULL_SIDE, "the back (north) is full");
        assert_eq!(stairs.cover[4], 0x00ff, "the front (south) only low");
        // East-facing stairs have their back to the east.
        let east = &s.models[stairs_id(0, 1, false) as usize].as_ref().unwrap();
        assert_eq!(east.cover[0], FULL_SIDE);
        assert_eq!(s.cover[STONE as usize], [FULL_SIDE; 6]);
        assert_eq!(s.cover[GLASS_B as usize], [0; 6]);
        assert_eq!(s.cover[TORCH_B as usize], [0; 6]);
    }

    #[test]
    fn turned_models_keep_their_textures_the_same_way_round() {
        let s = shapes();
        // The wall torch's top shows the same part of its texture whichever way it faces.
        let tops: Vec<(u8, [u8; 3])> = (0..4)
            .map(|f| {
                let m = s.models[(WALL_TORCH_B + f) as usize].as_ref().unwrap();
                (m.parts[0].faces[2].uvt, m.parts[0].from)
            })
            .collect();
        assert_eq!(tops[0], (0, [7, 3, 14]));
        assert_eq!(tops[1].1, [0, 3, 7], "east: against the wall to the west");
        // Beds: head half facing east has its pillow end on +X.
        let head = s.models[bed_id(0, 1, true) as usize].as_ref().unwrap();
        let end = BLOCKS[bed_id(0, 1, true) as usize].tex[2];
        assert_eq!(head.parts[0].faces[0].tex, end);
        assert_eq!(head.parts[0].faces[1].tex, NO_TEX, "the side against the foot isn't drawn");
    }

    const NORTH_F: u8 = 0;
}
