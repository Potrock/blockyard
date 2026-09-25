//! Main-thread world: sparse column storage, block edits, region extraction for the meshing
//! workers, voxel raycasting and player physics.

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

use crate::blocks::*;
use crate::gen::HEADER_BYTES;
use crate::mesher::REGION_HEADER;
use crate::shapes::shapes;

/// The original block of an edit mirrored before its column loaded (filled in when it loads).
const UNKNOWN: u8 = 255;

/// Small, fast hasher for integer keys.
#[derive(Default)]
pub struct FxHasher(u64);

impl Hasher for FxHasher {
    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.write_u64(b as u64);
        }
    }
    #[inline]
    fn write_u64(&mut self, i: u64) {
        self.0 = (self.0.rotate_left(5) ^ i).wrapping_mul(0x51_7cc1_b727_220a_95);
    }
    #[inline]
    fn write_i32(&mut self, i: i32) {
        self.write_u64(i as u32 as u64);
    }
    #[inline]
    fn write_u32(&mut self, i: u32) {
        self.write_u64(i as u64);
    }
}

pub type FxMap<K, V> = HashMap<K, V, BuildHasherDefault<FxHasher>>;

type Section = Box<[u8; 4096]>;

pub struct Column {
    sections: [Option<Section>; 16],
    emit: u16,
}

impl Column {
    fn mask(&self) -> u16 {
        let mut m = 0;
        for (s, sec) in self.sections.iter().enumerate() {
            if sec.is_some() {
                m |= 1 << s;
            }
        }
        m
    }
}

#[inline(always)]
fn key(cx: i32, cz: i32) -> u64 {
    ((cx as u32 as u64) << 32) | cz as u32 as u64
}

pub struct World {
    cols: FxMap<u64, Column>,
    /// Player edits per column: local index (y * 256 + z * 16 + x) -> block.
    edits: FxMap<u64, FxMap<u32, u8>>,
    /// What each edited cell held before its first edit this session (for `revert_edits`).
    originals: FxMap<u64, FxMap<u32, u8>>,
}

impl Default for World {
    fn default() -> Self {
        Self::new()
    }
}

impl World {
    pub fn new() -> Self {
        World { cols: FxMap::default(), edits: FxMap::default(), originals: FxMap::default() }
    }

    pub fn has_column(&self, cx: i32, cz: i32) -> bool {
        self.cols.contains_key(&key(cx, cz))
    }

    pub fn column_count(&self) -> usize {
        self.cols.len()
    }

    /// Insert a generated column (generator output format) and re-apply stored edits.
    pub fn insert_column(&mut self, cx: i32, cz: i32, data: &[u8]) {
        let mask = u16::from_le_bytes([data[0], data[1]]);
        let emit = u16::from_le_bytes([data[2], data[3]]);
        let mut col = Column { sections: Default::default(), emit };
        let mut off = HEADER_BYTES;
        for s in 0..16 {
            if mask & (1 << s) != 0 {
                let mut sec: Section = Box::new([0u8; 4096]);
                sec.copy_from_slice(&data[off..off + 4096]);
                off += 4096;
                col.sections[s] = Some(sec);
            }
        }
        let k = key(cx, cz);
        self.cols.insert(k, col);
        // Edits mirrored while this column was away don't know what they replaced: it's this.
        if let Some(orig) = self.originals.get_mut(&k) {
            let col = &self.cols[&k];
            for (&i, b) in orig.iter_mut() {
                if *b == UNKNOWN {
                    let (x, y, z) = ((i & 15) as usize, (i >> 8) as usize, ((i >> 4) & 15) as usize);
                    *b = col.sections[y >> 4].as_ref().map_or(AIR, |sec| sec[((y & 15) << 8) | (z << 4) | x]);
                }
            }
        }
        if let Some(edits) = self.edits.get(&k) {
            let list: Vec<(u32, u8)> = edits.iter().map(|(&i, &b)| (i, b)).collect();
            for (i, b) in list {
                let (x, y, z) = ((i & 15) as i32, (i >> 8) as i32, ((i >> 4) & 15) as i32);
                self.write(cx * 16 + x, y, cz * 16 + z, b);
            }
        }
    }

    pub fn remove_column(&mut self, cx: i32, cz: i32) {
        self.cols.remove(&key(cx, cz));
    }

    /// Block at world coordinates. Unloaded columns return `unloaded`; outside the world
    /// vertical range returns air.
    #[inline]
    pub fn get_or(&self, x: i32, y: i32, z: i32, unloaded: u8) -> u8 {
        if !(0..256).contains(&y) {
            return if y < 0 { BEDROCK } else { AIR };
        }
        match self.cols.get(&key(x >> 4, z >> 4)) {
            None => unloaded,
            Some(c) => match &c.sections[(y >> 4) as usize] {
                None => AIR,
                Some(s) => s[(((y & 15) << 8) | ((z & 15) << 4) | (x & 15)) as usize],
            },
        }
    }

    #[inline]
    pub fn get(&self, x: i32, y: i32, z: i32) -> u8 {
        self.get_or(x, y, z, AIR)
    }

    /// Copy the SOLID flag of every block in a box into `out` (x fastest, then z, then y).
    /// Unloaded columns count as solid. One hash lookup per column keeps this fast.
    pub fn solid_box(&self, x0: i32, y0: i32, z0: i32, sx: usize, sy: usize, sz: usize, out: &mut [u8]) {
        for dz in 0..sz {
            for dx in 0..sx {
                let x = x0 + dx as i32;
                let z = z0 + dz as i32;
                let col = self.cols.get(&key(x >> 4, z >> 4));
                for dy in 0..sy {
                    let y = y0 + dy as i32;
                    let b = if y < 0 {
                        BEDROCK
                    } else if y > 255 {
                        AIR
                    } else {
                        match col {
                            None => STONE,
                            Some(c) => match &c.sections[(y >> 4) as usize] {
                                None => AIR,
                                Some(s) => s[(((y & 15) << 8) | ((z & 15) << 4) | (x & 15)) as usize],
                            },
                        }
                    };
                    out[(dy * sz + dz) * sx + dx] = SOLID[b as usize];
                }
            }
        }
    }

    /// Raw write without recording an edit. Returns false if the column is not loaded.
    fn write(&mut self, x: i32, y: i32, z: i32, b: u8) -> bool {
        if !(0..256).contains(&y) {
            return false;
        }
        let Some(col) = self.cols.get_mut(&key(x >> 4, z >> 4)) else {
            return false;
        };
        let s = (y >> 4) as usize;
        if col.sections[s].is_none() {
            if b == AIR {
                return true;
            }
            col.sections[s] = Some(Box::new([0u8; 4096]));
        }
        let sec = col.sections[s].as_mut().unwrap();
        sec[(((y & 15) << 8) | ((z & 15) << 4) | (x & 15)) as usize] = b;
        // Keep the emitter mask exact for this section.
        let has_emitter = sec.iter().any(|&v| EMIT[v as usize] > 0);
        if has_emitter {
            col.emit |= 1 << s;
        } else {
            col.emit &= !(1 << s);
        }
        if b == AIR && sec.iter().all(|&v| v == AIR) {
            col.sections[s] = None;
        }
        true
    }

    /// Player edit: writes the block and records it so it survives unloading.
    pub fn set(&mut self, x: i32, y: i32, z: i32, b: u8) -> bool {
        let before = self.get_or(x, y, z, 255);
        if !self.write(x, y, z, b) {
            return false;
        }
        let local = (((y & 255) << 8) | ((z & 15) << 4) | (x & 15)) as u32;
        let k = key(x >> 4, z >> 4);
        self.edits.entry(k).or_default().insert(local, b);
        self.originals.entry(k).or_default().entry(local).or_insert(before);
        true
    }

    /// An edit made in another copy of the world (the simulation's, in a worker or on a server):
    /// written now if its column is loaded, else kept to apply when it loads. Returns whether
    /// the block changed now.
    pub fn mirror(&mut self, x: i32, y: i32, z: i32, b: u8) -> bool {
        if self.set(x, y, z, b) {
            return true;
        }
        if !(0..256).contains(&y) {
            return false;
        }
        let local = (((y & 255) << 8) | ((z & 15) << 4) | (x & 15)) as u32;
        let k = key(x >> 4, z >> 4);
        self.edits.entry(k).or_default().insert(local, b);
        self.originals.entry(k).or_default().entry(local).or_insert(UNKNOWN);
        false
    }

    /// Undo every edit made this session: loaded columns get their original blocks back, and
    /// the edits are forgotten (unloaded columns regenerate clean). Returns the loaded columns
    /// that changed, as flat [cx, cz, ...] pairs, for remeshing.
    pub fn revert_edits(&mut self) -> Vec<i32> {
        let mut touched = Vec::new();
        let originals = std::mem::take(&mut self.originals);
        for (k, cells) in originals {
            let (cx, cz) = ((k >> 32) as u32 as i32, k as u32 as i32);
            if let Some(e) = self.edits.get_mut(&k) {
                for i in cells.keys() {
                    e.remove(i);
                }
                if e.is_empty() {
                    self.edits.remove(&k);
                }
            }
            if !self.cols.contains_key(&k) {
                continue;
            }
            for (i, b) in cells {
                let (x, y, z) = ((i & 15) as i32, (i >> 8) as i32, ((i >> 4) & 15) as i32);
                self.write(cx * 16 + x, y, cz * 16 + z, b);
            }
            touched.push(cx);
            touched.push(cz);
        }
        touched
    }

    /// 3x3 neighbourhood of columns around (cx, cz) in the mesher's region format.
    pub fn extract_region(&self, cx: i32, cz: i32) -> Vec<u8> {
        let mut size = REGION_HEADER;
        let mut cols: [Option<&Column>; 9] = [None; 9];
        for dz in -1..=1 {
            for dx in -1..=1 {
                let k = ((dz + 1) * 3 + dx + 1) as usize;
                cols[k] = self.cols.get(&key(cx + dx, cz + dz));
                if let Some(c) = cols[k] {
                    size += c.mask().count_ones() as usize * 4096;
                }
            }
        }
        let mut out = Vec::with_capacity(size);
        out.resize(REGION_HEADER, 0);
        for (k, c) in cols.iter().enumerate() {
            if let Some(c) = c {
                out[k * 4..k * 4 + 2].copy_from_slice(&c.mask().to_le_bytes());
                out[k * 4 + 2..k * 4 + 4].copy_from_slice(&c.emit.to_le_bytes());
                for sec in c.sections.iter().flatten() {
                    out.extend_from_slice(&sec[..]);
                }
            }
        }
        out
    }

    /// Serialise edits: repeated [cx i32, cz i32, count u32, (local u32, block u8)*].
    pub fn export_edits(&self) -> Vec<u8> {
        let mut out = Vec::new();
        for (&k, m) in &self.edits {
            let cx = (k >> 32) as u32 as i32;
            let cz = k as u32 as i32;
            out.extend_from_slice(&cx.to_le_bytes());
            out.extend_from_slice(&cz.to_le_bytes());
            out.extend_from_slice(&(m.len() as u32).to_le_bytes());
            for (&i, &b) in m {
                out.extend_from_slice(&i.to_le_bytes());
                out.push(b);
            }
        }
        out
    }

    pub fn import_edits(&mut self, data: &[u8]) {
        let mut o = 0;
        let rd = |o: &mut usize| -> u32 {
            let v = u32::from_le_bytes([data[*o], data[*o + 1], data[*o + 2], data[*o + 3]]);
            *o += 4;
            v
        };
        while o + 12 <= data.len() {
            let cx = rd(&mut o) as i32;
            let cz = rd(&mut o) as i32;
            let n = rd(&mut o) as usize;
            let m = self.edits.entry(key(cx, cz)).or_default();
            for _ in 0..n {
                if o + 5 > data.len() {
                    return;
                }
                let i = rd(&mut o);
                let b = data[o];
                o += 1;
                m.insert(i, b);
            }
        }
    }

    pub fn clear_edits(&mut self) {
        self.edits.clear();
        self.originals.clear();
    }

    pub fn edit_count(&self) -> usize {
        self.edits.values().map(|m| m.len()).sum()
    }

    /// Approximate light at a point for entities / the held item: (sky 0..1, block 0..1).
    /// Sky: attenuated by whatever lies above. Block: strongest emitter within Manhattan reach.
    pub fn light_probe(&self, x: i32, y: i32, z: i32) -> (f32, f32) {
        let mut sky: i32 = 15;
        let mut yy = y + 1;
        while yy < 256 && sky > 0 {
            let b = self.get_or(x, yy, z, AIR);
            sky -= OPACITY[b as usize] as i32;
            yy += 1;
        }
        // Open sky nearby still lights overhangs a little.
        if sky <= 0 {
            for (dx, dz) in [(4, 0), (-4, 0), (0, 4), (0, -4)] {
                let mut open = true;
                for yy in (y + 1)..256.min(y + 48) {
                    if OPAQUE[self.get_or(x + dx, yy, z + dz, AIR) as usize] == 1 {
                        open = false;
                        break;
                    }
                }
                if open {
                    sky = sky.max(9);
                }
            }
        }
        let mut blk: i32 = 0;
        const R: i32 = 9;
        for dy in -R..=R {
            for dz in -R..=R {
                let rem = R - dy.abs() - dz.abs();
                if rem < 0 {
                    continue;
                }
                for dx in -rem..=rem {
                    let e = EMIT[self.get_or(x + dx, y + dy, z + dz, AIR) as usize] as i32;
                    if e > 0 {
                        let d = dx.abs() + dy.abs() + dz.abs();
                        blk = blk.max(e - d);
                    }
                }
            }
        }
        (sky.max(0) as f32 / 15.0, blk.max(0) as f32 / 15.0)
    }

    /// Distance along a ray to the first solid (collidable) block, or None within `max_dist`.
    /// Unloaded columns count as solid.
    pub fn raycast_solid(&self, o: [f64; 3], d: [f64; 3], max_dist: f64) -> Option<f64> {
        let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
        if len < 1e-12 {
            return None;
        }
        let d = [d[0] / len, d[1] / len, d[2] / len];
        let mut p = [o[0].floor() as i32, o[1].floor() as i32, o[2].floor() as i32];
        let step = [d[0].signum() as i32, d[1].signum() as i32, d[2].signum() as i32];
        let mut t_max = [0f64; 3];
        let mut t_delta = [0f64; 3];
        for a in 0..3 {
            if d[a].abs() < 1e-12 {
                t_max[a] = f64::INFINITY;
                t_delta[a] = f64::INFINITY;
            } else {
                let next = if d[a] > 0.0 { p[a] as f64 + 1.0 - o[a] } else { o[a] - p[a] as f64 };
                t_max[a] = next / d[a].abs();
                t_delta[a] = 1.0 / d[a].abs();
            }
        }
        let mut t = 0.0;
        loop {
            let b = self.get_or(p[0], p[1], p[2], STONE);
            if SOLID[b as usize] == 1 {
                if SHAPE[b as usize] != SHAPE_MODEL {
                    return Some(t);
                }
                // A slab or a bed: only its boxes stop the ray.
                if let Some((tb, _)) = ray_boxes(o, d, p, collision_boxes(b)) {
                    if tb <= max_dist {
                        return Some(tb);
                    }
                }
            }
            let a = if t_max[0] < t_max[1] {
                if t_max[0] < t_max[2] {
                    0
                } else {
                    2
                }
            } else if t_max[1] < t_max[2] {
                1
            } else {
                2
            };
            t = t_max[a];
            if t > max_dist {
                return None;
            }
            t_max[a] += t_delta[a];
            p[a] += step[a];
        }
    }

    /// DDA voxel raycast. Returns (block pos, face normal, block id, distance) of the first
    /// targetable block: a model (torch, slab, bed) only where the ray meets its boxes.
    pub fn raycast(&self, o: [f64; 3], d: [f64; 3], max_dist: f64) -> Option<([i32; 3], [i32; 3], u8, f64)> {
        let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
        if len < 1e-9 {
            return None;
        }
        let d = [d[0] / len, d[1] / len, d[2] / len];
        let mut p = [o[0].floor() as i32, o[1].floor() as i32, o[2].floor() as i32];
        let step = [d[0].signum() as i32, d[1].signum() as i32, d[2].signum() as i32];
        let mut t_max = [0f64; 3];
        let mut t_delta = [0f64; 3];
        for a in 0..3 {
            if d[a].abs() < 1e-12 {
                t_max[a] = f64::INFINITY;
                t_delta[a] = f64::INFINITY;
            } else {
                let next = if d[a] > 0.0 { p[a] as f64 + 1.0 - o[a] } else { o[a] - p[a] as f64 };
                t_max[a] = next / d[a].abs();
                t_delta[a] = 1.0 / d[a].abs();
            }
        }
        let mut normal = [0i32; 3];
        let mut t = 0.0;
        while t <= max_dist {
            let b = self.get(p[0], p[1], p[2]);
            if b != AIR && b != WATER_B && b != LAVA_B {
                if SHAPE[b as usize] != SHAPE_MODEL {
                    return Some((p, normal, b, t));
                }
                if let Some((tb, n)) = ray_boxes(o, d, p, target_boxes(b)) {
                    if tb <= max_dist {
                        return Some((p, n, b, tb));
                    }
                }
            }
            let a = if t_max[0] < t_max[1] {
                if t_max[0] < t_max[2] {
                    0
                } else {
                    2
                }
            } else if t_max[1] < t_max[2] {
                1
            } else {
                2
            };
            t = t_max[a];
            t_max[a] += t_delta[a];
            p[a] += step[a];
            normal = [0; 3];
            normal[a] = -step[a];
        }
        None
    }
}

const FULL_BOX: [[u8; 6]; 1] = [[0, 0, 0, 16, 16, 16]];

/// The boxes a block collides with, in 1/16 of a block within its cell (none if it isn't
/// solid): the whole cell, or a model's own (a slab's half, a bed 9/16 high).
#[inline]
pub fn collision_boxes(b: u8) -> &'static [[u8; 6]] {
    if SOLID[b as usize] == 0 {
        return &[];
    }
    target_boxes(b)
}

/// The boxes you aim at in a block: the whole cell, or a model's own (a torch's stick).
#[inline]
pub fn target_boxes(b: u8) -> &'static [[u8; 6]] {
    if SHAPE[b as usize] == SHAPE_MODEL {
        if let Some(m) = &shapes().models[b as usize] {
            return &m.bounds;
        }
    }
    &FULL_BOX
}

/// A box of a cell in world coordinates: (min, max).
#[inline]
fn world_box(cell: [i32; 3], b: &[u8; 6]) -> ([f64; 3], [f64; 3]) {
    let k = 1.0 / 16.0;
    (
        [cell[0] as f64 + b[0] as f64 * k, cell[1] as f64 + b[1] as f64 * k, cell[2] as f64 + b[2] as f64 * k],
        [cell[0] as f64 + b[3] as f64 * k, cell[1] as f64 + b[4] as f64 * k, cell[2] as f64 + b[5] as f64 * k],
    )
}

/// The nearest of a cell's boxes that a ray (unit `d`) meets: its distance and the normal of the
/// face it enters (zero if the ray starts inside).
pub fn ray_boxes(o: [f64; 3], d: [f64; 3], cell: [i32; 3], boxes: &[[u8; 6]]) -> Option<(f64, [i32; 3])> {
    let mut best: Option<(f64, [i32; 3])> = None;
    'boxes: for b in boxes {
        let (lo, hi) = world_box(cell, b);
        let (mut t0, mut t1) = (0.0f64, f64::INFINITY);
        let mut n = [0i32; 3];
        for a in 0..3 {
            if d[a].abs() < 1e-12 {
                if o[a] < lo[a] || o[a] > hi[a] {
                    continue 'boxes;
                }
                continue;
            }
            let (ta, tb) = ((lo[a] - o[a]) / d[a], (hi[a] - o[a]) / d[a]);
            let (near, far) = if ta < tb { (ta, tb) } else { (tb, ta) };
            if near > t0 {
                t0 = near;
                n = [0; 3];
                n[a] = if d[a] > 0.0 { -1 } else { 1 };
            }
            t1 = t1.min(far);
        }
        if t0 <= t1 && best.is_none_or(|(bt, _)| t0 < bt) {
            best = Some((t0, n));
        }
    }
    best
}

/// Whether an axis-aligned box (feet at `p`, half width `hw`, height `h`) overlaps solid blocks.
/// Unloaded columns count as solid so bodies never fall into ungenerated terrain.
pub fn aabb_collides(world: &World, p: [f64; 3], hw: f64, h: f64) -> bool {
    let lo = [p[0] - hw + EPS, p[1] + EPS, p[2] - hw + EPS];
    let hi = [p[0] + hw - EPS, p[1] + h - EPS, p[2] + hw - EPS];
    for y in lo[1].floor() as i32..=hi[1].floor() as i32 {
        for z in lo[2].floor() as i32..=hi[2].floor() as i32 {
            for x in lo[0].floor() as i32..=hi[0].floor() as i32 {
                for b in collision_boxes(world.get_or(x, y, z, STONE)) {
                    let (bl, bh) = world_box([x, y, z], b);
                    if (0..3).all(|a| bl[a] < hi[a] && bh[a] > lo[a]) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// How near two faces may be and still count as touching rather than overlapping.
const TOUCH: f64 = 1e-7;

/// Move a box along one axis, stopping flush against the first solid block (or block model box)
/// in its way. Boxes it's already inside don't stop it, so it can always get out. Returns true if
/// the move was blocked.
pub fn aabb_move_axis(world: &World, pos: &mut [f64; 3], axis: usize, delta: f64, hw: f64, h: f64) -> bool {
    if delta == 0.0 {
        return false;
    }
    let min = [pos[0] - hw, pos[1], pos[2] - hw];
    let max = [pos[0] + hw, pos[1] + h, pos[2] + hw];
    let (mut lo, mut hi) = (min, max);
    if delta > 0.0 {
        hi[axis] += delta;
    } else {
        lo[axis] += delta;
    }
    let mut d = delta;
    for y in (lo[1] - TOUCH).floor() as i32..=(hi[1] + TOUCH).floor() as i32 {
        for z in (lo[2] - TOUCH).floor() as i32..=(hi[2] + TOUCH).floor() as i32 {
            for x in (lo[0] - TOUCH).floor() as i32..=(hi[0] + TOUCH).floor() as i32 {
                for b in collision_boxes(world.get_or(x, y, z, STONE)) {
                    let (bl, bh) = world_box([x, y, z], b);
                    if !(0..3).all(|a| a == axis || (bl[a] < max[a] - TOUCH && bh[a] > min[a] + TOUCH)) {
                        continue;
                    }
                    if delta > 0.0 && bl[axis] >= max[axis] - TOUCH {
                        d = d.min(bl[axis] - max[axis]);
                    } else if delta < 0.0 && bh[axis] <= min[axis] + TOUCH {
                        d = d.max(bh[axis] - min[axis]);
                    }
                }
            }
        }
    }
    let blocked = d != delta;
    // Never backwards.
    pos[axis] += if delta > 0.0 { d.max(0.0) } else { d.min(0.0) };
    blocked
}

/// Up to this high, a walking body steps up onto what's in its way (a slab, a stair).
pub const STEP_UP: f64 = 0.6;

/// A walking box that was blocked going sideways from `start` (to `pos`) steps up onto what's in
/// its way if that's low enough: up, across, back down. Returns true if it did.
pub fn step_up(world: &World, pos: &mut [f64; 3], start: [f64; 3], axis: usize, delta: f64, hw: f64, h: f64) -> bool {
    let mut p = start;
    aabb_move_axis(world, &mut p, 1, STEP_UP, hw, h);
    let rise = p[1] - start[1];
    if rise <= EPS {
        return false;
    }
    aabb_move_axis(world, &mut p, axis, delta, hw, h);
    if (p[axis] - start[axis]).abs() <= (pos[axis] - start[axis]).abs() + EPS {
        return false;
    }
    aabb_move_axis(world, &mut p, 1, -rise, hw, h);
    if p[1] <= start[1] + EPS {
        return false;
    }
    *pos = p;
    true
}

/// Player physics state (AABB 0.6 x 1.8 x 0.6, feet position).
pub struct Player {
    pub pos: [f64; 3],
    pub vel: [f64; 3],
    pub on_ground: bool,
    pub in_water: bool,
    pub eyes_in_water: bool,
    pub in_lava: bool,
    pub flying: bool,
    pub frozen: bool,
    pub bob: f64,
}

pub const HALF_W: f64 = 0.3;
pub const HEIGHT: f64 = 1.8;
pub const EYE: f64 = 1.62;
const EPS: f64 = 1e-4;

pub struct MoveInput {
    /// Desired horizontal direction in world space (length <= 1).
    pub wish_x: f64,
    pub wish_z: f64,
    pub jump: bool,
    pub sneak: bool,
    pub sprint: bool,
}

impl Player {
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Player {
            pos: [x, y, z],
            vel: [0.0; 3],
            on_ground: false,
            in_water: false,
            eyes_in_water: false,
            in_lava: false,
            flying: false,
            frozen: false,
            bob: 0.0,
        }
    }

    fn collides(world: &World, p: [f64; 3]) -> bool {
        aabb_collides(world, p, HALF_W, HEIGHT)
    }

    /// Move along one axis, stopping at the first solid block. Returns true if blocked.
    fn move_axis(&mut self, world: &World, axis: usize, delta: f64) -> bool {
        aabb_move_axis(world, &mut self.pos, axis, delta, HALF_W, HEIGHT)
    }

    /// Add an instantaneous velocity change (knockback, launch pads...).
    pub fn impulse(&mut self, v: [f64; 3]) {
        for (a, d) in self.vel.iter_mut().zip(v) {
            *a += d;
        }
        if v[1] > 0.0 {
            self.on_ground = false;
        }
    }

    fn liquid_state(&mut self, world: &World) {
        let x = self.pos[0].floor() as i32;
        let z = self.pos[2].floor() as i32;
        let feet = world.get(x, (self.pos[1] + 0.2).floor() as i32, z);
        let waist = world.get(x, (self.pos[1] + 0.9).floor() as i32, z);
        let eye_y = self.pos[1] + EYE;
        let eyes = world.get(x, eye_y.floor() as i32, z);
        self.in_water = feet == WATER_B || waist == WATER_B;
        self.in_lava = feet == LAVA_B || waist == LAVA_B;
        // Water surface sits 0.125 below the block top.
        let above = world.get(x, eye_y.floor() as i32 + 1, z);
        let surface_ok = above == WATER_B || eye_y.fract() < 0.875;
        self.eyes_in_water = eyes == WATER_B && surface_ok;
    }

    pub fn step(&mut self, world: &World, input: &MoveInput, dt: f64) {
        if self.frozen {
            self.vel = [0.0; 3];
            return;
        }
        let dt = dt.min(0.1);
        let steps = ((dt / (1.0 / 120.0)).ceil() as usize).max(1);
        let h = dt / steps as f64;
        for _ in 0..steps {
            self.substep(world, input, h);
        }
    }

    fn substep(&mut self, world: &World, input: &MoveInput, dt: f64) {
        self.liquid_state(world);
        let wish = [input.wish_x, input.wish_z];
        let (target_speed, accel) = if self.flying {
            (if input.sprint { 21.0 } else { 10.9 }, 10.0)
        } else if self.in_water || self.in_lava {
            (if input.sprint { 3.4 } else { 2.3 }, 6.0)
        } else if input.sneak {
            (1.31, if self.on_ground { 14.0 } else { 3.0 })
        } else if input.sprint {
            (5.61, if self.on_ground { 14.0 } else { 3.0 })
        } else {
            (4.317, if self.on_ground { 14.0 } else { 3.0 })
        };

        // Horizontal acceleration toward the wished velocity (exponential approach).
        let k = 1.0 - (-accel * dt).exp();
        let tx = wish[0] * target_speed;
        let tz = wish[1] * target_speed;
        if self.flying || self.on_ground || wish[0] != 0.0 || wish[1] != 0.0 || self.in_water {
            self.vel[0] += (tx - self.vel[0]) * k;
            self.vel[2] += (tz - self.vel[2]) * k;
        }

        // Vertical.
        if self.flying {
            let ty = if input.jump { 8.0 } else if input.sneak { -8.0 } else { 0.0 };
            self.vel[1] += (ty - self.vel[1]) * (1.0 - (-10.0 * dt).exp());
        } else if self.in_water || self.in_lava {
            let drag = if self.in_lava { 4.0 } else { 2.2 };
            self.vel[1] -= 9.0 * dt;
            if input.jump {
                self.vel[1] += 24.0 * dt;
            }
            self.vel[1] *= (-drag * dt).exp();
            self.vel[1] = self.vel[1].clamp(-4.0, 4.0);
            let hdrag = (-1.5 * dt).exp();
            self.vel[0] *= hdrag;
            self.vel[2] *= hdrag;
        } else {
            self.vel[1] -= 32.0 * dt;
            self.vel[1] = self.vel[1].max(-60.0);
            if input.jump && self.on_ground {
                self.vel[1] = 9.0;
                self.on_ground = false;
            }
        }

        // Sneaking on the ground: don't walk off edges.
        let guard = input.sneak && self.on_ground && !self.flying;

        let dy = self.vel[1] * dt;
        let blocked_y = self.move_axis(world, 1, dy);
        if blocked_y {
            if self.vel[1] < 0.0 {
                self.on_ground = true;
            }
            self.vel[1] = 0.0;
        } else {
            self.on_ground = false;
            // Resting exactly on a surface: probe slightly below.
            let mut probe = self.pos;
            probe[1] -= 0.02;
            if self.vel[1] <= 0.0 && Self::collides(world, probe) {
                self.on_ground = true;
            }
        }
        if self.flying && self.on_ground {
            self.flying = false;
        }

        for axis in [0usize, 2] {
            let d = self.vel[axis] * dt;
            if guard {
                let mut p = self.pos;
                p[axis] += d;
                p[1] -= 0.6;
                if !Self::collides(world, p) {
                    self.vel[axis] = 0.0;
                    continue;
                }
            }
            let before = self.pos;
            if self.move_axis(world, axis, d) {
                if self.on_ground && !self.flying && step_up(world, &mut self.pos, before, axis, d, HALF_W, HEIGHT) {
                    continue;
                }
                // Climb out of water onto a ledge.
                if self.in_water && input.jump {
                    self.vel[1] = self.vel[1].max(5.0);
                }
                self.vel[axis] = 0.0;
            }
        }

        let speed = (self.vel[0] * self.vel[0] + self.vel[2] * self.vel[2]).sqrt();
        if self.on_ground && !self.flying {
            self.bob += speed * dt;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gen::Generator;

    #[test]
    fn revert_restores_generated_blocks() {
        let mut w = World::new();
        let mut g = crate::gen::Generator::new(7);
        let data = g.generate(0, 0);
        w.insert_column(0, 0, &data);
        let before: Vec<u8> = (0..256).map(|y| w.get(5, y, 5)).collect();
        for y in 60..90 {
            w.set(5, y, 5, 0);
        }
        w.set(5, 70, 5, 3); // edited twice: the original is the generated block
        assert_ne!(w.edit_count(), 0);
        let touched = w.revert_edits();
        assert_eq!(touched, vec![0, 0]);
        let after: Vec<u8> = (0..256).map(|y| w.get(5, y, 5)).collect();
        assert_eq!(before, after);
        assert_eq!(w.edit_count(), 0);
        // Reloading the column regenerates it without the reverted edits.
        w.remove_column(0, 0);
        w.insert_column(0, 0, &data);
        assert_eq!(before, (0..256).map(|y| w.get(5, y, 5)).collect::<Vec<u8>>());
    }

    #[test]
    fn mirrored_edits_wait_for_their_column() {
        let mut g = Generator::new(7);
        let data = g.generate(0, 0);
        let mut w = World::new();
        assert!(!w.mirror(5, 200, 5, GLOWSTONE_B), "column not loaded yet");
        assert!(!w.mirror(6, 30, 6, AIR));
        w.insert_column(0, 0, &data);
        assert_eq!(w.get(5, 200, 5), GLOWSTONE_B);
        assert_eq!(w.get(6, 30, 6), AIR);
        assert!(w.mirror(7, 200, 7, GLOWSTONE_B), "loaded now");
        // Reverting restores what the generator put there, learned when the column loaded.
        let mut clean = World::new();
        clean.insert_column(0, 0, &data);
        w.revert_edits();
        for (x, y, z) in [(5, 200, 5), (6, 30, 6), (7, 200, 7)] {
            assert_eq!(w.get(x, y, z), clean.get(x, y, z));
        }
        assert_eq!(w.edit_count(), 0);
    }

    #[test]
    fn edits_survive_reload() {
        let mut g = Generator::new(5);
        let mut w = World::new();
        let d = g.generate(0, 0);
        w.insert_column(0, 0, &d);
        assert!(w.set(3, 200, 4, GLOWSTONE_B));
        assert_eq!(w.get(3, 200, 4), GLOWSTONE_B);
        w.remove_column(0, 0);
        assert_eq!(w.get_or(3, 200, 4, 255), 255);
        w.insert_column(0, 0, &d);
        assert_eq!(w.get(3, 200, 4), GLOWSTONE_B);
        let r = w.extract_region(0, 0);
        assert_eq!(u16::from_le_bytes([r[16 + 2], r[16 + 3]]) & (1 << 12), 1 << 12, "emitter bit for section 12");
        let e = w.export_edits();
        let mut w2 = World::new();
        w2.import_edits(&e);
        w2.insert_column(0, 0, &d);
        assert_eq!(w2.get(3, 200, 4), GLOWSTONE_B);
    }

    /// A flat world (3x3 columns round the origin) and the height of its first air block.
    fn flat() -> (World, i32) {
        let mut g = Generator::new(1);
        g.set_flat(64.0);
        let mut w = World::new();
        for cz in -1..=1 {
            for cx in -1..=1 {
                let d = g.generate(cx, cz);
                w.insert_column(cx, cz, &d);
            }
        }
        let top = (0..256).find(|&y| w.get(8, y, 8) == AIR).unwrap();
        (w, top)
    }

    fn walk(w: &World, p: &mut Player, wish_x: f64, secs: f64) {
        let input = MoveInput { wish_x, wish_z: 0.0, jump: false, sneak: false, sprint: false };
        for _ in 0..(secs * 60.0) as usize {
            p.step(w, &input, 1.0 / 60.0);
        }
    }

    #[test]
    fn walks_up_slabs_and_stairs_but_not_blocks() {
        let (mut w, top) = flat();
        // A bottom slab, then oak stairs climbing east, then a full block past the stairs' top.
        w.set(10, top, 8, slab_id(0, false));
        w.set(12, top, 8, stairs_id(0, 1, false));
        w.set(13, top + 1, 8, STONE);
        let mut p = Player::new(8.5, top as f64, 8.5);
        walk(&w, &mut p, 0.0, 0.5);
        assert!(p.on_ground && (p.pos[1] - top as f64).abs() < 1e-6, "standing on the ground: {:?}", p.pos);
        walk(&w, &mut p, 1.0, 0.6);
        assert!(p.pos[0] > 10.4 && (p.pos[1] - (top as f64 + 0.5)).abs() < 1e-6, "on the slab: {:?}", p.pos);
        walk(&w, &mut p, 1.0, 1.0);
        // Up the stairs' lower step (another half), then the block stops it.
        assert!((p.pos[1] - (top as f64 + 1.0)).abs() < 1e-6, "on the stairs: {:?}", p.pos);
        assert!(p.pos[0] <= 13.0 - HALF_W + 1e-6 && p.pos[0] > 12.5, "stopped by the block past the stairs: {:?}", p.pos);
        // A box sitting on the slab's top doesn't collide; one reaching into it does.
        assert!(!aabb_collides(&w, [10.5, top as f64 + 0.5, 8.5], 0.3, 1.8));
        assert!(aabb_collides(&w, [10.5, top as f64 + 0.4, 8.5], 0.3, 1.8));
    }

    #[test]
    fn rays_hit_model_boxes() {
        let (mut w, top) = flat();
        w.set(8, top, 8, slab_id(0, false));
        w.set(8, top, 9, TORCH_B);
        let y = top as f64;
        // Straight down onto the slab's top face, halfway down its cell.
        let (p, n, b, t) = w.raycast([8.5, y + 3.0, 8.5], [0.0, -1.0, 0.0], 6.0).unwrap();
        assert_eq!((p, n, b), ([8, top, 8], [0, 1, 0], slab_id(0, false)));
        assert!((t - 2.5).abs() < 1e-9);
        // Over the slab's empty upper half and past the torch's stick: nothing.
        assert!(w.raycast([8.5, y + 0.75, 5.0], [0.0, 0.0, 1.0], 3.4).is_none());
        assert!(w.raycast([8.05, y + 0.25, 9.5], [1.0, 0.0, 0.0], 0.2).is_none(), "beside the torch");
        let (p, _, b, _) = w.raycast([8.5, y + 0.25, 7.2], [0.0, 0.0, 1.0], 3.0).unwrap();
        assert_eq!((p, b), ([8, top, 8], slab_id(0, false)), "the slab's side");
        let (p, n, b, _) = w.raycast([8.5, y + 0.5, 11.0], [0.0, 0.0, -1.0], 3.0).unwrap();
        assert_eq!((p, n, b), ([8, top, 9], [0, 0, 1], TORCH_B), "the torch's stick");
        // Solid rays (arrows, line of sight) pass over the slab and through the torch.
        assert!(w.raycast_solid([8.5, y + 0.75, 5.0], [0.0, 0.0, 1.0], 6.0).is_none());
        assert!(w.raycast_solid([8.5, y + 0.25, 5.0], [0.0, 0.0, 1.0], 6.0).is_some());
    }

    #[test]
    fn player_lands_on_ground() {
        let mut g = Generator::new(5);
        let mut w = World::new();
        for cz in -1..=1 {
            for cx in -1..=1 {
                let d = g.generate(cx, cz);
                w.insert_column(cx, cz, &d);
            }
        }
        let mut p = Player::new(8.5, 200.0, 8.5);
        let input = MoveInput { wish_x: 0.0, wish_z: 0.0, jump: false, sneak: false, sprint: false };
        for _ in 0..600 {
            p.step(&w, &input, 1.0 / 60.0);
        }
        assert!(p.on_ground || p.in_water, "player should settle");
        let below = w.get(8, (p.pos[1] - 0.5).floor() as i32, 8);
        assert!(SOLID[below as usize] == 1 || p.in_water, "standing on solid, got {below}");
        let hit = w.raycast([8.5, p.pos[1] + EYE, 8.5], [0.0, -1.0, 0.0], 8.0);
        assert!(hit.is_some());
    }
}
