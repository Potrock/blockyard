//! Lighting + meshing for one chunk column, computed from the 3x3 neighbourhood of columns.
//!
//! Light level 15 falls to 0 within 15 steps, so every light source (sky or block) that can reach
//! the centre column (plus the 1-block border sampled for smooth lighting) lies inside the 48x48
//! region. Lighting computed here is therefore exact and seamless across chunks.
//!
//! Region input layout (`World::extract_region`):
//! ```text
//! 9 x (u16 LE section mask, u16 LE emitter mask), columns ordered dz = -1..1 (outer), dx = -1..1
//! then, per column in that order, 4096 bytes per set section (index (y * 16 + z) * 16 + x)
//! ```
//!
//! Output (`Vec<u32>`): `MESH_HEADER` words of header followed by vertex data of the opaque,
//! cutout and translucent layers. Each quad is 4 vertices x 2 words:
//! ```text
//! w0: x(5) | z(5)<<5 | y(9)<<10 | normal(3)<<19 | ao(2)<<22 | anim(2)<<24 | tint<<26 | xmax/umax<<27 | zmax/vmax<<28 | cutout<<29 | fine<<30 | uvt.0<<31
//! w1: texture layer(10) | uvt.1-2 (2)<<10 | sky*4 (6)<<12 | block*4 (6)<<18 | fx(4)<<24 | fz(4)<<28
//! ```
//! normal: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z, 6/7 cross planes. anim: 0 none, 1 leaves, 2 plant
//! top vertex, 3 liquid surface vertex (lowered). xmax/zmax flag cross vertices on the far corner.
//! uvt: texture transform (`UV_*` in `blocks`).
//!
//! A `fine` vertex (block models: torches, slabs, stairs, beds) is a point of its block's cell on
//! the 1/16 grid: the cell (x 4 bits, z 4 bits, y 8 bits, each field's top bit spare) and the
//! offset into it in sixteenths, 0..=16 (5 bits each): ox = fx | x.4 << 4, oz = fz | z.4 << 4,
//! oy = (anim bits) | (umax/vmax bits) << 2 | y.8 << 4. Knowing its cell, the shader maps the
//! texture exactly within that block's tile. Fine quads don't animate or widen.
//!
//! Header:
//! ```text
//! [0] header length    [1..4] quad count per layer
//! [4 + s*3 + l]        quad start of section s (0..=16) in layer l
//! [55 + s]             section info: connectivity (15 bits) | sunlit << 16 | has blocks << 17
//! ```

use crate::blocks::*;
use crate::shapes::{on_side, shapes, side_mask, Cuboid, Model, FULL_SIDE, NO_TEX, OPPOSITE};

pub const RW: usize = 48;
const SZ: usize = RW;
const SY: usize = RW * RW;
/// Storage layers: y = -1 (below world, solid) ..= 256 (above world, open sky).
const LAYERS: usize = 258;
pub const REGION_HEADER: usize = 36;
pub const MESH_HEADER: usize = 80;

#[inline(always)]
fn ri(x: usize, y: usize, z: usize) -> usize {
    // y is the storage layer (world y + 1)
    y * SY + z * SZ + x
}

/// Face direction offsets in region index space.
const FACE_OFF: [isize; 6] = [1, -1, SY as isize, -(SY as isize), SZ as isize, -(SZ as isize)];
/// Tangent (U) and bitangent (V) offsets per face.
const U_OFF: [isize; 6] = [SZ as isize, SZ as isize, 1, 1, 1, 1];
const V_OFF: [isize; 6] = [SY as isize, SY as isize, SZ as isize, SZ as isize, SY as isize, SY as isize];
/// Faces whose (u, v) winding must be reversed to face outward.
const REVERSE: [bool; 6] = [true, false, true, false, false, true];
const CORNER_SIGNS: [(isize, isize); 4] = [(-1, -1), (1, -1), (1, 1), (-1, 1)];

/// Pair index for connectivity bits between faces i < j.
const fn pair_table() -> [[u8; 6]; 6] {
    let mut t = [[0u8; 6]; 6];
    let mut k = 0u8;
    let mut i = 0;
    while i < 6 {
        let mut j = i + 1;
        while j < 6 {
            t[i][j] = k;
            t[j][i] = k;
            k += 1;
            j += 1;
        }
        i += 1;
    }
    t
}
const PAIR: [[u8; 6]; 6] = pair_table();
pub const ALL_CONNECTED: u32 = 0x7fff;
/// Vertex flag (w0 bit 29): quad belongs to the alpha-tested cutout layer.
pub const CUTOUT_FLAG: u32 = 1 << 29;
/// Vertex flag (w0 bit 30): a block model vertex, on the 1/16 grid.
pub const FINE_FLAG: u32 = 1 << 30;

#[derive(Clone, Copy, PartialEq, Eq)]
struct Corner {
    ao: u8,
    sky: u8,
    blk: u8,
}

pub struct Mesher {
    blocks: Vec<u8>,
    sky: Vec<u8>,
    blk: Vec<u8>,
    queue: Vec<u32>,
    low: Vec<u16>,
    top: usize,
    masks: [u16; 9],
    emits: [u16; 9],
    out: [Vec<u32>; 3],
    sec_start: [[u32; 17]; 3],
    sec_info: [u32; 16],
    greedy: Vec<u32>,
    slice_used: [bool; 96],
    visited: Vec<u8>,
    stack: Vec<u16>,
}

impl Default for Mesher {
    fn default() -> Self {
        Self::new()
    }
}

impl Mesher {
    pub fn new() -> Self {
        Mesher {
            blocks: vec![0; LAYERS * SY],
            sky: vec![0; LAYERS * SY],
            blk: vec![0; LAYERS * SY],
            queue: Vec::with_capacity(1 << 16),
            low: vec![0; SY],
            top: 0,
            masks: [0; 9],
            emits: [0; 9],
            out: [Vec::with_capacity(1 << 16), Vec::with_capacity(1 << 14), Vec::with_capacity(1 << 12)],
            sec_start: [[0; 17]; 3],
            sec_info: [0; 16],
            greedy: vec![0; 6 * 16 * 256],
            slice_used: [false; 96],
            visited: vec![0; 4096],
            stack: Vec::with_capacity(4096),
        }
    }

    /// Light + mesh the centre column of a region. Returns header + vertex data.
    pub fn mesh(&mut self, region: &[u8]) -> Vec<u32> {
        self.load(region);
        self.light_sky();
        self.light_block();
        self.build();
        self.assemble()
    }

    fn load(&mut self, data: &[u8]) {
        self.blocks.fill(AIR);
        // Below-world layer behaves like solid stone.
        self.blocks[..SY].fill(STONE);
        let mut off = REGION_HEADER;
        let mut max_s = 0usize;
        for k in 0..9 {
            let mask = u16::from_le_bytes([data[k * 4], data[k * 4 + 1]]);
            let emit = u16::from_le_bytes([data[k * 4 + 2], data[k * 4 + 3]]);
            self.masks[k] = mask;
            self.emits[k] = emit;
            let xo = (k % 3) * 16;
            let zo = (k / 3) * 16;
            for s in 0..16 {
                if mask & (1 << s) == 0 {
                    continue;
                }
                let src = &data[off..off + 4096];
                off += 4096;
                for y in 0..16 {
                    for z in 0..16 {
                        let d = ri(xo, s * 16 + y + 1, zo + z);
                        let so = (y * 16 + z) * 16;
                        self.blocks[d..d + 16].copy_from_slice(&src[so..so + 16]);
                    }
                }
                max_s = max_s.max(s + 1);
            }
        }
        self.top = max_s * 16;
    }

    fn light_sky(&mut self) {
        let top = self.top;
        let Mesher { blocks, sky, queue, low, .. } = self;
        // Everything at or above `top` is open sky.
        sky[..(top + 1) * SY].fill(0);
        sky[(top + 1) * SY..].fill(15);
        queue.clear();
        for z in 0..RW {
            for x in 0..RW {
                let base = z * SZ + x;
                let mut y = top as isize - 1;
                while y >= 0 {
                    let i = (y as usize + 1) * SY + base;
                    let op = OPACITY[blocks[i] as usize];
                    if op == 0 {
                        sky[i] = 15;
                        y -= 1;
                        continue;
                    }
                    if op < 15 {
                        sky[i] = 15 - op;
                        queue.push(i as u32);
                    } else if LIT_INSIDE[blocks[i] as usize] == 1 {
                        sky[i] = 15;
                    }
                    break;
                }
                low[base] = (y + 1) as u16;
            }
        }
        // Seed horizontal spread where a neighbouring column's sky column starts higher.
        for z in 0..RW {
            for x in 0..RW {
                let base = z * SZ + x;
                let l = low[base];
                let mut m = l;
                if x > 0 {
                    m = m.max(low[base - 1]);
                }
                if x + 1 < RW {
                    m = m.max(low[base + 1]);
                }
                if z > 0 {
                    m = m.max(low[base - SZ]);
                }
                if z + 1 < RW {
                    m = m.max(low[base + SZ]);
                }
                for y in l..m {
                    queue.push(((y as usize + 1) * SY + base) as u32);
                }
            }
        }
        bfs(blocks, sky, queue);
    }

    fn light_block(&mut self) {
        let top = self.top;
        let Mesher { blocks, blk, queue, emits, .. } = self;
        blk.fill(0);
        queue.clear();
        for k in 0..9 {
            let e = emits[k];
            if e == 0 {
                continue;
            }
            let xo = (k % 3) * 16;
            let zo = (k / 3) * 16;
            for s in 0..16 {
                if e & (1 << s) == 0 {
                    continue;
                }
                for y in 0..16 {
                    for z in 0..16 {
                        let row = ri(xo, s * 16 + y + 1, zo + z);
                        for x in 0..16 {
                            let i = row + x;
                            let em = EMIT[blocks[i] as usize];
                            if em > 0 {
                                blk[i] = em;
                                queue.push(i as u32);
                            }
                        }
                    }
                }
            }
        }
        let _ = top;
        bfs(blocks, blk, queue);
    }

    #[inline(always)]
    fn corners(&self, q: usize, face: usize) -> [Corner; 4] {
        let du = U_OFF[face];
        let dv = V_OFF[face];
        let b = &self.blocks;
        let mut out = [Corner { ao: 3, sky: 0, blk: 0 }; 4];
        for (k, &(su, sv)) in CORNER_SIGNS.iter().enumerate() {
            let s1 = (q as isize + su * du) as usize;
            let s2 = (q as isize + sv * dv) as usize;
            let c = (q as isize + su * du + sv * dv) as usize;
            let o1 = OPAQUE[b[s1] as usize];
            let o2 = OPAQUE[b[s2] as usize];
            let oc = OPAQUE[b[c] as usize];
            let both = o1 & o2;
            let ao = if both == 1 { 0 } else { 3 - (o1 + o2 + oc) };
            let mut ss = self.sky[q] as u32;
            let mut sb = self.blk[q] as u32;
            let mut n = 1u32;
            if o1 == 0 {
                ss += self.sky[s1] as u32;
                sb += self.blk[s1] as u32;
                n += 1;
            }
            if o2 == 0 {
                ss += self.sky[s2] as u32;
                sb += self.blk[s2] as u32;
                n += 1;
            }
            if oc == 0 && both == 0 {
                ss += self.sky[c] as u32;
                sb += self.blk[c] as u32;
                n += 1;
            }
            out[k] = Corner { ao, sky: ((ss * 4 + n / 2) / n) as u8, blk: ((sb * 4 + n / 2) / n) as u8 };
        }
        out
    }

    fn build(&mut self) {
        for o in self.out.iter_mut() {
            o.clear();
        }
        let center = self.masks[4];
        for s in 0..16 {
            for l in 0..3 {
                self.sec_start[l][s] = (self.out[l].len() / 8) as u32;
            }
            if center & (1 << s) == 0 {
                self.sec_info[s] = ALL_CONNECTED;
                continue;
            }
            let (sunlit, opaque_count) = self.mesh_section(s);
            let conn = if opaque_count == 0 {
                ALL_CONNECTED
            } else if opaque_count == 4096 {
                0
            } else {
                self.connectivity(s)
            };
            self.sec_info[s] = conn | ((sunlit as u32) << 16) | (1 << 17);
        }
        for l in 0..3 {
            self.sec_start[l][16] = (self.out[l].len() / 8) as u32;
        }
    }

    /// Returns (sunlit, opaque block count).
    fn mesh_section(&mut self, s: usize) -> (bool, u32) {
        let mut sunlit = false;
        let mut opaque_count = 0u32;
        let shapes = shapes();
        let cover = &shapes.cover;
        self.slice_used = [false; 96];
        let y0 = s * 16;
        for ly in 0..16 {
            let y = y0 + ly;
            for lz in 0..16 {
                for lx in 0..16 {
                    let i = ri(16 + lx, y + 1, 16 + lz);
                    let b = self.blocks[i];
                    if b == AIR {
                        continue;
                    }
                    let shape = SHAPE[b as usize];
                    let def = block(b);
                    if OPAQUE[b as usize] == 1 {
                        opaque_count += 1;
                    }
                    match shape {
                        SHAPE_CUBE if def.layer == Layer::Opaque => {
                            for f in 0..6 {
                                let q = (i as isize + FACE_OFF[f]) as usize;
                                if cover[self.blocks[q] as usize][OPPOSITE[f]] == FULL_SIDE {
                                    continue;
                                }
                                let c = self.corners(q, f);
                                if c.iter().any(|c| c.sky > 0) {
                                    sunlit = true;
                                }
                                let tex = def.tex[f] as u32;
                                let uvt = def.uvt[f] as u32;
                                let (slice, u, v) = match f {
                                    0 | 1 => (lx, lz, ly),
                                    2 | 3 => (ly, lx, lz),
                                    _ => (lz, lx, ly),
                                };
                                if c[0] == c[1] && c[0] == c[2] && c[0] == c[3] {
                                    let key = (1u32 << 31)
                                        | tex
                                        | ((def.tint as u32) << 12)
                                        | ((c[0].ao as u32) << 13)
                                        | ((c[0].sky as u32) << 15)
                                        | ((c[0].blk as u32) << 21)
                                        | (uvt << 27);
                                    let si = f * 16 + slice;
                                    self.greedy[si * 256 + v * 16 + u] = key;
                                    self.slice_used[si] = true;
                                } else {
                                    let plane = slice + if f % 2 == 0 { 1 } else { 0 };
                                    let tint = def.tint as u32;
                                    emit_quad(&mut self.out[0], f, plane, u, v, u + 1, v + 1, y0, &c, tex, tint, uvt, [0; 4], 0);
                                }
                            }
                        }
                        SHAPE_CUBE => {
                            // Cutout cube: leaves / glass.
                            for f in 0..6 {
                                let q = (i as isize + FACE_OFF[f]) as usize;
                                let nb = self.blocks[q];
                                if cover[nb as usize][OPPOSITE[f]] == FULL_SIDE {
                                    continue;
                                }
                                if def.cull_self && nb == b {
                                    continue;
                                }
                                if def.leaves && block(nb).leaves && f % 2 == 1 {
                                    continue;
                                }
                                let c = self.corners(q, f);
                                if c.iter().any(|c| c.sky > 0) {
                                    sunlit = true;
                                }
                                let (slice, u, v) = match f {
                                    0 | 1 => (lx, lz, ly),
                                    2 | 3 => (ly, lx, lz),
                                    _ => (lz, lx, ly),
                                };
                                let plane = slice + if f % 2 == 0 { 1 } else { 0 };
                                let anim = def.anim;
                                emit_quad(&mut self.out[1], f, plane, u, v, u + 1, v + 1, y0, &c, def.tex[f] as u32, def.tint as u32, def.uvt[f] as u32, [anim; 4], CUTOUT_FLAG);
                            }
                        }
                        SHAPE_CROSS => {
                            let c = Corner { ao: 3, sky: self.sky[i] * 4, blk: self.blk[i] * 4 };
                            if c.sky > 0 {
                                sunlit = true;
                            }
                            emit_cross(&mut self.out[1], lx, y, lz, c, def.tex[0] as u32, def.tint as u32, def.anim);
                        }
                        SHAPE_LIQUID => {
                            let layer = def.layer as usize;
                            let above = self.blocks[i + SY];
                            let surface = above != b;
                            for f in 0..6 {
                                let q = (i as isize + FACE_OFF[f]) as usize;
                                let nb = self.blocks[q];
                                if nb == b || cover[nb as usize][OPPOSITE[f]] == FULL_SIDE {
                                    continue;
                                }
                                let c = self.corners(q, f);
                                let (slice, u, v) = match f {
                                    0 | 1 => (lx, lz, ly),
                                    2 | 3 => (ly, lx, lz),
                                    _ => (lz, lx, ly),
                                };
                                let plane = slice + if f % 2 == 0 { 1 } else { 0 };
                                let lowered = if !surface {
                                    [0; 4]
                                } else if f == 2 {
                                    [3; 4]
                                } else if f == 3 {
                                    [0; 4]
                                } else {
                                    [0, 0, 3, 3]
                                };
                                emit_quad(&mut self.out[layer], f, plane, u, v, u + 1, v + 1, y0, &c, def.tex[f] as u32, 0, 0, lowered, 0);
                            }
                        }
                        SHAPE_MODEL => {
                            if let Some(m) = &shapes.models[b as usize] {
                                if self.mesh_model(m, def, i, lx, y, lz, cover) {
                                    sunlit = true;
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
        // Greedy merge uniform opaque faces.
        for si in 0..96 {
            if !self.slice_used[si] {
                continue;
            }
            let f = si / 16;
            let slice = si % 16;
            let plane = slice + if f % 2 == 0 { 1 } else { 0 };
            let m = &mut self.greedy[si * 256..(si + 1) * 256];
            for v in 0..16 {
                let mut u = 0;
                while u < 16 {
                    let k = m[v * 16 + u];
                    if k == 0 {
                        u += 1;
                        continue;
                    }
                    let mut w = 1;
                    while u + w < 16 && m[v * 16 + u + w] == k {
                        w += 1;
                    }
                    let mut h = 1;
                    'grow: while v + h < 16 {
                        for d in 0..w {
                            if m[(v + h) * 16 + u + d] != k {
                                break 'grow;
                            }
                        }
                        h += 1;
                    }
                    for dv in 0..h {
                        for du in 0..w {
                            m[(v + dv) * 16 + u + du] = 0;
                        }
                    }
                    let c = Corner { ao: ((k >> 13) & 3) as u8, sky: ((k >> 15) & 63) as u8, blk: ((k >> 21) & 63) as u8 };
                    emit_quad(&mut self.out[0], f, plane, u, v, u + w, v + h, y0, &[c; 4], k & 1023, (k >> 12) & 1, (k >> 27) & 7, [0; 4], 0);
                    u += w;
                }
            }
        }
        (sunlit, opaque_count)
    }

    /// Emit a block model's boxes. Returns whether the sky lights any of it.
    #[allow(clippy::too_many_arguments)]
    fn mesh_model(&mut self, m: &Model, def: &Block, i: usize, lx: usize, y: usize, lz: usize, cover: &[[u16; 6]; 256]) -> bool {
        let layer = if def.layer == Layer::Opaque { 0 } else { 1 };
        let flags = if layer == 1 { CUTOUT_FLAG } else { 0 };
        let own = Corner { ao: 3, sky: self.sky[i] * 4, blk: self.blk[i] * 4 };
        let cell = [lx as u32, y as u32, lz as u32];
        let mut sunlit = false;
        for p in &m.parts {
            for f in 0..6 {
                let face = p.faces[f];
                if face.tex == NO_TEX {
                    continue;
                }
                let q = (i as isize + FACE_OFF[f]) as usize;
                let nb = self.blocks[q] as usize;
                // Against the cell's side: hidden if the neighbour fills that part of it.
                if on_side(p, f) && (side_mask(p, f, false) & !cover[nb][OPPOSITE[f]]) == 0 {
                    continue;
                }
                // Lit smoothly from the cell it faces, like a cube face; from its own cell where
                // that one's solid (under a top slab) and for small things (torches).
                let c = if m.flat_light || OPAQUE[nb] == 1 { [own; 4] } else { self.corners(q, f) };
                if c.iter().any(|c| c.sky > 0) {
                    sunlit = true;
                }
                emit_fine(&mut self.out[layer], f, p, cell, &c, face.tex as u32, def.tint as u32, face.uvt as u32, flags);
            }
        }
        sunlit
    }

    /// Which pairs of section faces are connected through non-opaque blocks.
    fn connectivity(&mut self, s: usize) -> u32 {
        let Mesher { blocks, visited, stack, .. } = self;
        visited.fill(0);
        let y0 = s * 16;
        let opaque_at = |c: usize| -> bool {
            let (x, y, z) = (c & 15, c >> 8, (c >> 4) & 15);
            OPAQUE[blocks[ri(16 + x, y0 + y + 1, 16 + z)] as usize] == 1
        };
        let mut conn = 0u32;
        for start in 0..4096usize {
            if visited[start] != 0 {
                continue;
            }
            visited[start] = 1;
            if opaque_at(start) {
                continue;
            }
            let mut faces = 0u8;
            stack.clear();
            stack.push(start as u16);
            while let Some(c) = stack.pop() {
                let c = c as usize;
                let (x, y, z) = (c & 15, c >> 8, (c >> 4) & 15);
                faces |= ((x == 15) as u8)
                    | (((x == 0) as u8) << 1)
                    | (((y == 15) as u8) << 2)
                    | (((y == 0) as u8) << 3)
                    | (((z == 15) as u8) << 4)
                    | (((z == 0) as u8) << 5);
                let mut nbs = [usize::MAX; 6];
                if x < 15 {
                    nbs[0] = c + 1;
                }
                if x > 0 {
                    nbs[1] = c - 1;
                }
                if y < 15 {
                    nbs[2] = c + 256;
                }
                if y > 0 {
                    nbs[3] = c - 256;
                }
                if z < 15 {
                    nbs[4] = c + 16;
                }
                if z > 0 {
                    nbs[5] = c - 16;
                }
                for n in nbs {
                    if n != usize::MAX && visited[n] == 0 {
                        visited[n] = 1;
                        if !opaque_at(n) {
                            stack.push(n as u16);
                        }
                    }
                }
            }
            for i in 0..6 {
                if faces & (1 << i) == 0 {
                    continue;
                }
                for j in (i + 1)..6 {
                    if faces & (1 << j) != 0 {
                        conn |= 1 << PAIR[i][j];
                    }
                }
            }
            if conn == ALL_CONNECTED {
                break;
            }
        }
        conn
    }

    fn assemble(&self) -> Vec<u32> {
        let total: usize = self.out.iter().map(|o| o.len()).sum();
        let mut v = Vec::with_capacity(MESH_HEADER + total);
        v.resize(MESH_HEADER, 0);
        v[0] = MESH_HEADER as u32;
        for l in 0..3 {
            v[1 + l] = (self.out[l].len() / 8) as u32;
        }
        for s in 0..17 {
            for l in 0..3 {
                v[4 + s * 3 + l] = self.sec_start[l][s];
            }
        }
        for s in 0..16 {
            v[55 + s] = self.sec_info[s];
        }
        for o in &self.out {
            v.extend_from_slice(o);
        }
        v
    }
}

fn bfs(blocks: &[u8], light: &mut [u8], queue: &mut Vec<u32>) {
    let mut head = 0;
    while head < queue.len() {
        let i = queue[head] as usize;
        head += 1;
        let l = light[i];
        if l <= 1 {
            continue;
        }
        let x = i % RW;
        let z = (i / RW) % RW;
        let y = i / SY;
        let mut visit = |n: usize, queue: &mut Vec<u32>| {
            let b = blocks[n] as usize;
            let op = OPACITY[b];
            if op >= 15 {
                // A slab or stairs: lit, but the light goes no further.
                if LIT_INSIDE[b] == 1 && l - 1 > light[n] {
                    light[n] = l - 1;
                }
                return;
            }
            let nl = l as i32 - (op.max(1)) as i32;
            if nl > light[n] as i32 {
                light[n] = nl as u8;
                queue.push(n as u32);
            }
        };
        if x > 0 {
            visit(i - 1, queue);
        }
        if x + 1 < RW {
            visit(i + 1, queue);
        }
        if z > 0 {
            visit(i - SZ, queue);
        }
        if z + 1 < RW {
            visit(i + SZ, queue);
        }
        if y > 1 {
            visit(i - SY, queue);
        }
        if y + 1 < LAYERS {
            visit(i + SY, queue);
        }
    }
}

#[inline(always)]
fn pos(face: usize, plane: usize, u: usize, v: usize) -> (u32, u32, u32) {
    match face {
        0 | 1 => (plane as u32, v as u32, u as u32),
        2 | 3 => (u as u32, plane as u32, v as u32),
        _ => (u as u32, v as u32, plane as u32),
    }
}

#[inline(always)]
fn brightness(c: &Corner) -> u32 {
    c.ao as u32 * 30 + c.sky.max(c.blk) as u32
}

/// Emit one quad. (u0, v0)..(u1, v1) are section-local face-plane coordinates; `y0` is the section
/// base height (added to the y axis). `corners` and `anim` follow the (u, v) corner order.
#[allow(clippy::too_many_arguments)]
#[inline(always)]
fn emit_quad(
    out: &mut Vec<u32>,
    face: usize,
    plane: usize,
    u0: usize,
    v0: usize,
    u1: usize,
    v1: usize,
    y0: usize,
    corners: &[Corner; 4],
    tex: u32,
    tint: u32,
    uvt: u32,
    anim: [u8; 4],
    flags: u32,
) {
    let uv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)];
    let mut order: [usize; 4] = if REVERSE[face] { [0, 3, 2, 1] } else { [0, 1, 2, 3] };
    let b = |k: usize| brightness(&corners[order[k]]);
    if b(0) + b(2) > b(1) + b(3) {
        order = [order[1], order[2], order[3], order[0]];
    }
    for &k in &order {
        let (u, v) = uv[k];
        let (x, mut y, z) = pos(face, plane, u, v);
        y += y0 as u32;
        let c = &corners[k];
        // Corner side along u / v (bits 27, 28) lets the shader expand quads a hair to hide
        // T-junction cracks between greedy-merged faces.
        let side = (((k == 1 || k == 2) as u32) << 27) | (((k >= 2) as u32) << 28);
        let w0 = x | (z << 5) | (y << 10) | ((face as u32) << 19) | ((c.ao as u32) << 22) | ((anim[k] as u32) << 24) | (tint << 26) | side | flags | ((uvt & 1) << 31);
        let w1 = tex | ((uvt >> 1) << 10) | ((c.sky as u32) << 12) | ((c.blk as u32) << 18);
        out.push(w0);
        out.push(w1);
    }
}

/// Emit one face of a model box in block `cell` (x and z section-local, y absolute).
/// `corners` follow the (u, v) corner order, like `emit_quad`.
#[allow(clippy::too_many_arguments)]
fn emit_fine(out: &mut Vec<u32>, face: usize, p: &Cuboid, cell: [u32; 3], corners: &[Corner; 4], tex: u32, tint: u32, uvt: u32, flags: u32) {
    let lo = [p.from[0] as u32, p.from[1] as u32, p.from[2] as u32];
    let hi = [p.to[0] as u32, p.to[1] as u32, p.to[2] as u32];
    // The face's plane and its (u, v) extent, laid out as `pos` reads them.
    let (plane, u0, v0, u1, v1) = match face {
        0 => (hi[0], lo[2], lo[1], hi[2], hi[1]),
        1 => (lo[0], lo[2], lo[1], hi[2], hi[1]),
        2 => (hi[1], lo[0], lo[2], hi[0], hi[2]),
        3 => (lo[1], lo[0], lo[2], hi[0], hi[2]),
        4 => (hi[2], lo[0], lo[1], hi[0], hi[1]),
        _ => (lo[2], lo[0], lo[1], hi[0], hi[1]),
    };
    let uv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)];
    let mut order: [usize; 4] = if REVERSE[face] { [0, 3, 2, 1] } else { [0, 1, 2, 3] };
    let b = |k: usize| brightness(&corners[order[k]]);
    if b(0) + b(2) > b(1) + b(3) {
        order = [order[1], order[2], order[3], order[0]];
    }
    for &k in &order {
        let (u, v) = uv[k];
        let (ox, oy, oz) = pos(face, plane as usize, u as usize, v as usize);
        let c = &corners[k];
        let w0 = cell[0]
            | ((ox >> 4) << 4)
            | (cell[2] << 5)
            | ((oz >> 4) << 9)
            | (cell[1] << 10)
            | ((oy >> 4) << 18)
            | ((face as u32) << 19)
            | ((c.ao as u32) << 22)
            | ((oy & 3) << 24)
            | (tint << 26)
            | (((oy >> 2) & 3) << 27)
            | flags
            | FINE_FLAG
            | ((uvt & 1) << 31);
        let w1 = tex | ((uvt >> 1) << 10) | ((c.sky as u32) << 12) | ((c.blk as u32) << 18) | ((ox & 15) << 24) | ((oz & 15) << 28);
        out.push(w0);
        out.push(w1);
    }
}

#[allow(clippy::too_many_arguments)]
fn emit_cross(out: &mut Vec<u32>, lx: usize, y: usize, lz: usize, c: Corner, tex: u32, tint: u32, anim: u8) {
    let (x, y, z) = (lx as u32, y as u32, lz as u32);
    // (dx, dz) of the bottom two corners for each diagonal plane; top corners repeat them.
    let planes: [(u32, [(u32, u32); 2]); 2] = [(6, [(0, 0), (1, 1)]), (7, [(1, 0), (0, 1)])];
    for (normal, ends) in planes {
        let verts = [(ends[0], 0u32), (ends[1], 0u32), (ends[1], 1u32), (ends[0], 1u32)];
        for ((dx, dz), dy) in verts {
            let a = if dy == 1 && anim == 2 { 2 } else { 0 };
            let w0 = (x + dx)
                | ((z + dz) << 5)
                | ((y + dy) << 10)
                | (normal << 19)
                | ((c.ao as u32) << 22)
                | (a << 24)
                | (tint << 26)
                | (dx << 27)
                | (dz << 28)
                | CUTOUT_FLAG;
            let w1 = tex | ((c.sky as u32) << 12) | ((c.blk as u32) << 18);
            out.push(w0);
            out.push(w1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gen::Generator;
    use crate::world::World;

    fn region_for(g: &mut Generator, w: &mut World, cx: i32, cz: i32) -> Vec<u8> {
        for dz in -1..=1 {
            for dx in -1..=1 {
                if !w.has_column(cx + dx, cz + dz) {
                    let d = g.generate(cx + dx, cz + dz);
                    w.insert_column(cx + dx, cz + dz, &d);
                }
            }
        }
        w.extract_region(cx, cz)
    }

    #[test]
    fn mesh_flat_region() {
        // Single stone layer at y = 0 everywhere, torch in the middle of the centre column.
        let mut data = vec![0u8; REGION_HEADER];
        for k in 0..9 {
            data[k * 4] = 1;
        }
        for k in 0..9 {
            let mut sec = vec![0u8; 4096];
            for i in 0..256 {
                sec[i] = STONE;
            }
            if k == 4 {
                sec[(1 * 16 + 8) * 16 + 8] = TORCH_B;
                data[k * 4 + 2] = 1;
            }
            data.extend_from_slice(&sec);
        }
        let mut m = Mesher::new();
        let out = m.mesh(&data);
        let opaque = out[1];
        assert!(opaque > 0 && opaque <= 256, "opaque quads {opaque}");
        assert_eq!(out[2], 5, "torch box: 5 faces (the underside is on the stone)");
        // Torch light: block light at the torch cell is 14.
        assert_eq!(m.blk[ri(24, 2, 24)], 14);
        assert_eq!(m.sky[ri(24, 5, 24)], 15);
    }

    #[test]
    fn greedy_merges_flat_layer() {
        let mut data = vec![0u8; REGION_HEADER];
        for k in 0..9 {
            data[k * 4] = 1;
        }
        for _ in 0..9 {
            let mut sec = vec![0u8; 4096];
            for i in 0..256 {
                sec[i] = STONE;
            }
            data.extend_from_slice(&sec);
        }
        let mut m = Mesher::new();
        let out = m.mesh(&data);
        assert_eq!(out[1], 1, "one merged top quad");
        // The stone floor seals the -Y face; every other pair of faces is connected.
        let conn = out[55] & ALL_CONNECTED;
        assert_eq!(conn.count_ones(), 10);
        assert!(conn & (1 << PAIR[0][1]) != 0 && conn & (1 << PAIR[2][3]) == 0);
    }

    #[test]
    fn mesh_generated_timing() {
        let mut g = Generator::new(99);
        let mut w = World::new();
        let mut m = Mesher::new();
        let mut regions = vec![];
        for cz in 0..4 {
            for cx in 0..4 {
                regions.push(region_for(&mut g, &mut w, cx, cz));
            }
        }
        let t = std::time::Instant::now();
        let mut quads = 0;
        for r in &regions {
            let out = m.mesh(r);
            quads += out[1] + out[2] + out[3];
        }
        let per = t.elapsed().as_secs_f64() * 1000.0 / regions.len() as f64;
        eprintln!("mesh: {per:.3} ms/column (native), avg quads {}", quads as usize / regions.len());
    }
}
