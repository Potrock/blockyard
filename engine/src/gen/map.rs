//! A game's own landform: a coarse grid of ground heights, zones and water levels that the
//! generator interpolates, roughens with fine noise and dresses zone by zone (surface blocks,
//! trees, plants, outcrops, veins), in place of the endless natural terrain.
//!
//! A map world has no 3D density noise (no overhangs): the ground is a height field, so a tree's
//! foot is known from its own column and trees may be far bigger than the natural ones. Caves,
//! ores, blueprints and terraforms work as they do in a natural world.

use super::*;
use crate::json::{self, Json};

pub const TREE_OAK: u8 = 0;
pub const TREE_SPRUCE: u8 = 1;
pub const TREE_BROAD: u8 = 2;
pub const TREE_COLUMN: u8 = 3;
pub const TREE_PALM: u8 = 4;
pub const TREE_JUNGLE: u8 = 5;
pub const TREE_GIANT: u8 = 6;
pub const TREE_DEAD: u8 = 7;
pub const TREE_BUSH: u8 = 8;

/// Where a scattered block goes: standing on the ground, in place of its top block, or in veins
/// through the stone below.
pub const SCATTER_ON: u8 = 0;
pub const SCATTER_IN: u8 = 1;
pub const SCATTER_UNDER: u8 = 2;

#[derive(Clone, Debug)]
pub struct MapTree {
    pub shape: u8,
    pub log: u8,
    pub leaves: u8,
    pub hmin: i32,
    pub hmax: i32,
    /// The chance of one in each cell of its grid (small trees: 6 blocks; big ones: 10).
    pub density: f32,
    /// Stands in shallow water too.
    pub wet: bool,
}

impl MapTree {
    /// The big shapes are placed on a wider grid and reach further from their trunks.
    fn big(&self) -> bool {
        self.shape == TREE_JUNGLE || self.shape == TREE_GIANT
    }
}

#[derive(Clone, Debug)]
pub struct MapScatter {
    pub block: u8,
    /// The share of columns that get one (veins: a hundredth of the veins in each chunk).
    pub density: f32,
    pub mode: u8,
    /// About how many blocks: 1 is a single block, more a boulder or the length of a vein.
    pub size: i32,
    /// Only in patches about this many blocks across (0: evenly).
    pub clumps: f32,
}

#[derive(Clone, Debug)]
pub struct MapZone {
    pub top: u8,
    pub fill: u8,
    pub depth: i32,
    /// The block of slopes steeper than `steepness` (blocks of height per block).
    pub steep: u8,
    pub steepness: f32,
    /// The ground under liquid.
    pub bed: u8,
    /// Bands of rock under the surface and on steep slopes, bottom to top, two blocks each.
    pub strata: Vec<u8>,
    pub liquid: u8,
    pub frozen: bool,
    pub grass: [u8; 3],
    pub roughness: f32,
    pub crags: f32,
    pub trees: Vec<MapTree>,
    pub scatter: Vec<MapScatter>,
}

pub struct TerrainMap {
    pub origin: [i32; 2],
    pub cell: i32,
    pub width: i32,
    pub depth: i32,
    /// Ground height at each sample, in 1/256 of a block.
    pub heights: Vec<u16>,
    pub zone_of: Vec<u8>,
    /// The y of the top liquid block at each sample; 0 where the ground is dry (the sea needs none).
    pub water: Vec<u8>,
    pub outside_height: f32,
    pub outside_zone: u8,
    pub zones: Vec<MapZone>,
    leafy: [bool; 256],
}

impl TerrainMap {
    /// `palette` is a JSON list of zones (block ids already resolved):
    ///
    /// ```text
    /// { "top": id, "fill": id, "depth": n, "steep": id, "steepness": f, "bed": id, "strata": [id],
    ///   "liquid": id, "frozen": bool, "grass": [r, g, b], "roughness": f, "crags": f,
    ///   "trees": [{ "shape": 0..8, "log": id, "leaves": id, "h": [min, max], "density": f, "wet": bool }],
    ///   "scatter": [{ "block": id, "density": f, "where": 0 | 1 | 2, "size": n, "clumps": f }] }
    /// ```
    #[allow(clippy::too_many_arguments)]
    pub fn new(origin: [i32; 2], cell: i32, width: i32, depth: i32, heights: &[u16], zone_of: &[u8], water: &[u8], outside_height: f32, outside_zone: u8, palette: &str) -> Result<TerrainMap, String> {
        if cell < 1 || width < 2 || depth < 2 {
            return Err("terrain map: needs a cell of 1 or more and at least 2 x 2 samples".into());
        }
        let n = (width as usize) * (depth as usize);
        if heights.len() != n || zone_of.len() != n || (!water.is_empty() && water.len() != n) {
            return Err(format!("terrain map: heights, zones and water must each have width x depth = {n} samples"));
        }
        let v = json::parse(palette)?;
        let list = v.as_arr().ok_or("terrain map: the palette must be a list")?;
        if list.is_empty() || list.len() > 256 {
            return Err("terrain map: the palette needs 1 to 256 zones".into());
        }
        let count = registry().count;
        let mut zones = Vec::with_capacity(list.len());
        let mut leafy = [false; 256];
        for (i, z) in list.iter().enumerate() {
            let num = |v: &Json, k: &str, def: f64| v.get(k).and_then(Json::as_f64).unwrap_or(def);
            let id = |v: &Json, k: &str, def: u8| -> Result<u8, String> {
                let n = num(v, k, def as f64);
                if n < 0.0 || n as usize >= count || n.fract() != 0.0 {
                    return Err(format!("terrain map: zone {i}: {k} isn't a block"));
                }
                Ok(n as u8)
            };
            let top = id(z, "top", GRASS)?;
            let fill = id(z, "fill", DIRT)?;
            let mut strata = Vec::new();
            for s in z.get("strata").and_then(Json::as_arr).unwrap_or(&[]) {
                let n = s.as_f64().filter(|n| *n >= 0.0 && (*n as usize) < count).ok_or(format!("terrain map: zone {i}: strata: not a block"))?;
                strata.push(n as u8);
            }
            let mut grass = [0x6a, 0xb0, 0x45];
            if let Some(g) = z.get("grass").and_then(Json::as_arr).filter(|g| g.len() == 3) {
                for (o, c) in grass.iter_mut().zip(g) {
                    *o = c.as_f64().unwrap_or(128.0).clamp(0.0, 255.0) as u8;
                }
            }
            let mut trees = Vec::new();
            for t in z.get("trees").and_then(Json::as_arr).unwrap_or(&[]) {
                let h = t.get("h").and_then(Json::as_arr).filter(|h| h.len() == 2).ok_or(format!("terrain map: zone {i}: a tree needs h: [min, max]"))?;
                let hmin = (h[0].as_f64().unwrap_or(4.0) as i32).clamp(1, 64);
                let tree = MapTree {
                    shape: (num(t, "shape", 0.0) as u8).min(TREE_BUSH),
                    log: id(t, "log", OAK_LOG_B)?,
                    leaves: id(t, "leaves", OAK_LEAVES_B)?,
                    hmin,
                    hmax: (h[1].as_f64().unwrap_or(6.0) as i32).clamp(hmin, 64),
                    density: num(t, "density", 0.1) as f32,
                    wet: t.get("wet").and_then(Json::as_bool).unwrap_or(false),
                };
                leafy[tree.leaves as usize] = true;
                trees.push(tree);
            }
            let mut scatter = Vec::new();
            for s in z.get("scatter").and_then(Json::as_arr).unwrap_or(&[]) {
                scatter.push(MapScatter {
                    block: id(s, "block", STONE)?,
                    density: num(s, "density", 0.01) as f32,
                    mode: (num(s, "where", 0.0) as u8).min(SCATTER_UNDER),
                    size: (num(s, "size", 1.0) as i32).clamp(1, 64),
                    clumps: num(s, "clumps", 0.0) as f32,
                });
            }
            zones.push(MapZone {
                top,
                fill,
                depth: (num(z, "depth", 3.0) as i32).clamp(0, 32),
                steep: id(z, "steep", STONE)?,
                steepness: num(z, "steepness", 3.0) as f32,
                bed: id(z, "bed", SAND)?,
                strata,
                liquid: id(z, "liquid", WATER_B)?,
                frozen: z.get("frozen").and_then(Json::as_bool).unwrap_or(false),
                grass,
                roughness: num(z, "roughness", 1.5) as f32,
                crags: num(z, "crags", 0.0) as f32,
                trees,
                scatter,
            });
        }
        if zone_of.iter().any(|&z| z as usize >= zones.len()) || outside_zone as usize >= zones.len() {
            return Err("terrain map: a sample's zone isn't in the palette".into());
        }
        Ok(TerrainMap { origin, cell, width, depth, heights: heights.to_vec(), zone_of: zone_of.to_vec(), water: water.to_vec(), outside_height, outside_zone, zones, leafy })
    }

    #[inline(always)]
    fn inside(&self, i: i32, j: i32) -> bool {
        i >= 0 && j >= 0 && i < self.width && j < self.depth
    }

    #[inline(always)]
    fn height(&self, i: i32, j: i32) -> f32 {
        if self.inside(i, j) {
            self.heights[(j * self.width + i) as usize] as f32 * (1.0 / 256.0)
        } else {
            self.outside_height
        }
    }

    #[inline(always)]
    fn zone(&self, i: i32, j: i32) -> u8 {
        if self.inside(i, j) {
            self.zone_of[(j * self.width + i) as usize]
        } else {
            self.outside_zone
        }
    }

    #[inline(always)]
    fn water(&self, i: i32, j: i32) -> u8 {
        if !self.water.is_empty() && self.inside(i, j) {
            self.water[(j * self.width + i) as usize]
        } else {
            0
        }
    }
}

/// One column of a map world.
#[derive(Clone, Copy, Default)]
pub(super) struct MapCol {
    h: f32,
    zone: u8,
    /// The zone whose liquid fills the column, if `level` says it's wet.
    liquid_zone: u8,
    /// The y of the map's top liquid block here, or -1 where the map has none near.
    level: i32,
    grass: [u8; 3],
}

#[inline(always)]
fn catmull(p0: f32, p1: f32, p2: f32, p3: f32, t: f32) -> f32 {
    p1 + 0.5 * t * (p2 - p0 + t * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + t * (3.0 * (p1 - p2) + p3 - p0)))
}

/// The highest solid y of a column whose ground is at `h`.
#[inline(always)]
fn top_of(h: f32) -> i32 {
    (h.ceil() as i32 - 1).clamp(1, H as i32 - 2)
}

impl Generator {
    pub fn set_map(&mut self, map: TerrainMap) {
        self.mcols = vec![MapCol::default(); A * A];
        self.wet = vec![false; A * A];
        self.map = Some(std::rc::Rc::new(map));
    }

    /// The map's column at world (x, z): interpolated ground, fine noise, zone and liquid.
    fn map_column(&self, m: &TerrainMap, x: i32, z: i32) -> MapCol {
        let inv = 1.0 / m.cell as f32;
        let gx = (x - m.origin[0]) as f32 * inv;
        let gz = (z - m.origin[1]) as f32 * inv;
        let (ix, iz) = (gx.floor() as i32, gz.floor() as i32);
        let (tx, tz) = (gx - ix as f32, gz - iz as f32);
        let (fx, fz) = (x as f32, z as f32);

        // Ground: Catmull-Rom through the samples, held between the four around the column so a
        // river's bed and banks stay where the map put them.
        let mut rows = [0f32; 4];
        for (j, row) in rows.iter_mut().enumerate() {
            let jz = iz - 1 + j as i32;
            *row = catmull(m.height(ix - 1, jz), m.height(ix, jz), m.height(ix + 1, jz), m.height(ix + 2, jz), tx);
        }
        let c = [m.height(ix, iz), m.height(ix + 1, iz), m.height(ix, iz + 1), m.height(ix + 1, iz + 1)];
        let lo = c[0].min(c[1]).min(c[2]).min(c[3]);
        let hi = c[0].max(c[1]).max(c[2]).max(c[3]);
        let mut h = catmull(rows[0], rows[1], rows[2], rows[3], tz).clamp(lo, hi);

        // What varies smoothly across a cell: grass colour, roughness, and the liquid's level.
        let mut grass = [0f32; 3];
        let (mut rough, mut crags) = (0f32, 0f32);
        let (mut wet, mut level, mut best, mut liquid_zone) = (0f32, 0f32, 0f32, 0u8);
        for (k, w) in [(1.0 - tx) * (1.0 - tz), tx * (1.0 - tz), (1.0 - tx) * tz, tx * tz].into_iter().enumerate() {
            let (i, j) = (ix + (k & 1) as i32, iz + (k >> 1) as i32);
            let zi = m.zone(i, j);
            let zone = &m.zones[zi as usize];
            for (g, c) in grass.iter_mut().zip(zone.grass) {
                *g += w * c as f32;
            }
            rough += w * zone.roughness;
            crags += w * zone.crags;
            let l = m.water(i, j);
            if l > 0 && w > 0.0 {
                wet += w;
                level += w * l as f32;
                if w > best {
                    best = w;
                    liquid_zone = zi;
                }
            }
        }

        // Fine noise, stilled where the map keeps liquid (its bed and banks hold it in).
        let still = 1.0 - wet;
        if still > 0.0 {
            let mut d = self.n_detail.fbm2(fx / 72.0, fz / 72.0, 4) * 1.6 * rough;
            if crags > 0.0 {
                let r = 1.0 - self.n_pv.n2(fx / 26.0, fz / 26.0).abs();
                d += r * r * crags;
            }
            h += d * still;
        }
        let (tw, th) = self.terraform_at(fx, fz);
        if tw > 0.0 {
            h = lerp(h, th, tw);
        }

        // Zones are picked through a slow warp, so their borders wander instead of following cells.
        let wx = gx + self.n_warp.n2(fx / 23.0, fz / 23.0) * 0.48;
        let wz = gz + self.n_warp.n2(fx / 23.0 + 71.3, fz / 23.0 - 33.7) * 0.48;
        let zone = m.zone((wx + 0.5).floor() as i32, (wz + 0.5).floor() as i32);

        let mut out = [0u8; 3];
        for (o, g) in out.iter_mut().zip(grass) {
            *o = (g + 0.5).clamp(0.0, 255.0) as u8;
        }
        MapCol { h, zone, liquid_zone, level: if wet > 0.0 { (level / wet).round() as i32 } else { -1 }, grass: out }
    }

    /// The column at world (x, z): from the chunk's area if it's there, else worked out.
    fn map_col(&self, m: &TerrainMap, x0: i32, z0: i32, x: i32, z: i32) -> MapCol {
        let (ax, az) = (x - x0 + M, z - z0 + M);
        if (0..A as i32).contains(&ax) && (0..A as i32).contains(&az) {
            self.mcols[az as usize * A + ax as usize]
        } else {
            self.map_column(m, x, z)
        }
    }

    /// The top liquid block of a column (-1 if dry) and the liquid: the map's where it gives a
    /// level above the ground, the sea's below sea level.
    fn liquid(m: &TerrainMap, c: &MapCol, top: i32) -> (i32, u8) {
        if c.level > top && c.level >= SEA {
            (c.level.min(H as i32 - 2), m.zones[c.liquid_zone as usize].liquid)
        } else if top < SEA {
            (SEA, WATER_B)
        } else {
            (-1, AIR)
        }
    }

    pub(super) fn map_tint(&self, lx: usize, lz: usize) -> [u8; 3] {
        self.mcols[(lz + M as usize) * A + lx + M as usize].grass
    }

    pub(super) fn generate_map(&mut self, cx: i32, cz: i32, m: &TerrainMap) -> Vec<u8> {
        let x0 = cx * W as i32;
        let z0 = cz * W as i32;

        // 1. The map's columns over the area (chunk + margin M), and their tops.
        for az in 0..A {
            for ax in 0..A {
                let c = self.map_column(m, x0 - M + ax as i32, z0 - M + az as i32);
                let top = top_of(c.h);
                self.mcols[az * A + ax] = c;
                self.tops[az * A + ax] = top;
                self.wet[az * A + ax] = Self::liquid(m, &c, top).0 > top;
            }
        }

        // 2. Ground, surface and liquid.
        self.blocks.fill(AIR);
        for lz in 0..W {
            for lx in 0..W {
                let ai = (lz + M as usize) * A + lx + M as usize;
                let c = self.mcols[ai];
                let zone = &m.zones[c.zone as usize];
                let top = self.tops[ai];
                let (wx, wz) = (x0 + lx as i32, z0 + lz as i32);
                let mut slope: f32 = 0.0;
                for n in [ai - 1, ai + 1, ai - A, ai + A] {
                    slope = slope.max((self.mcols[n].h - c.h).abs());
                }
                let (ltop, liquid) = Self::liquid(m, &c, top);
                let under = ltop > top;
                let steep = !under && slope > zone.steepness;
                let (topb, fill, fdepth) = if under {
                    (zone.bed, zone.bed, 3)
                } else if steep {
                    (zone.steep, zone.steep, 1)
                } else {
                    (zone.top, zone.fill, zone.depth)
                };
                let banded = !zone.strata.is_empty();
                let wobble = if banded { (self.n_patch.n2(wx as f32 / 40.0, wz as f32 / 40.0) * 2.5) as i32 + 64 } else { 0 };
                let band = |y: i32| zone.strata[((y + wobble) / 2) as usize % zone.strata.len()];
                let deep_dither = (hash2(self.seed ^ 0x5eed, wx, wz) % 5) as i32;
                for y in 0..=top {
                    let depth = top - y;
                    let b = if depth <= fdepth && !(steep && banded) {
                        if depth == 0 { topb } else { fill }
                    } else if banded && depth <= 48 {
                        band(y)
                    } else if fill == SAND && depth <= fdepth + 3 {
                        SANDSTONE_B
                    } else if y < 4 + deep_dither {
                        DEEPSLATE_B
                    } else {
                        STONE
                    };
                    self.blocks[bidx(lx, y as usize, lz)] = b;
                }
                for y in top + 1..=ltop {
                    let frozen = y == ltop && liquid == WATER_B && m.zones[c.zone as usize].frozen;
                    self.blocks[bidx(lx, y as usize, lz)] = if frozen { ICE_B } else { liquid };
                }
            }
        }

        // 3. Caves, ores, and the zones' own veins.
        self.carve_caves(x0, z0);
        self.place_ores(cx, cz);
        self.place_map_veins(cx, cz, m);

        // 4. Boulders and outcrops, trees, then what stands on or in the ground.
        self.place_map_boulders(x0, z0, m);
        self.place_map_trees(x0, z0, m);
        self.place_map_scatter(x0, z0, m);

        self.lay_bedrock(x0, z0);
        if !self.blueprints.is_empty() {
            self.stamp_blueprints(x0, z0);
        }
        self.pack(cx, cz)
    }

    /// Veins of the zone at the chunk's middle, through the stone under it.
    fn place_map_veins(&mut self, cx: i32, cz: i32, m: &TerrainMap) {
        let ai = (8 + M as usize) * A + 8 + M as usize;
        let zone = &m.zones[self.mcols[ai].zone as usize];
        let ymax = (self.tops[ai] - 2).max(8);
        let mut rng = Rng::new(((hash2(self.seed ^ 0x7e1b, cx, cz) as u64) << 32) | hash2(self.seed ^ 0x3a9, cz, cx) as u64);
        for s in zone.scatter.iter().filter(|s| s.mode == SCATTER_UNDER) {
            self.veins(&mut rng, s.block, s.density * 100.0, (s.size * 2 / 3).max(1), s.size * 4 / 3 + 1, 5, ymax);
        }
    }

    /// Whether scatter `k` of a zone grows at (x, z): everywhere, or only inside its patches.
    fn in_clump(&self, s: &MapScatter, k: usize, x: i32, z: i32) -> bool {
        s.clumps <= 0.0 || self.n_flower.n2(x as f32 / s.clumps + k as f32 * 31.7, z as f32 / s.clumps - k as f32 * 17.3) > 0.25
    }

    /// Boulders (on the ground) and outcrops (sunk into it): scattered blocks of more than one.
    fn place_map_boulders(&mut self, x0: i32, z0: i32, m: &TerrainMap) {
        const CELL: i32 = 8;
        const REACH: i32 = 3;
        for gz in (z0 - REACH).div_euclid(CELL)..=(z0 + W as i32 - 1 + REACH).div_euclid(CELL) {
            for gx in (x0 - REACH).div_euclid(CELL)..=(x0 + W as i32 - 1 + REACH).div_euclid(CELL) {
                let h = hash2(self.seed ^ 0xb01d, gx, gz);
                let bx = gx * CELL + (h % CELL as u32) as i32;
                let bz = gz * CELL + ((h >> 8) % CELL as u32) as i32;
                if bx < x0 - REACH || bx >= x0 + W as i32 + REACH || bz < z0 - REACH || bz >= z0 + W as i32 + REACH {
                    continue;
                }
                let c = self.map_col(m, x0, z0, bx, bz);
                let zone = &m.zones[c.zone as usize];
                let mut r = unit(hash32(h ^ 0xde5));
                let mut pick = None;
                for (k, s) in zone.scatter.iter().enumerate() {
                    if s.mode == SCATTER_UNDER || s.size <= 1 || !self.in_clump(s, k, bx, bz) {
                        continue;
                    }
                    let p = (s.density * (CELL * CELL) as f32).min(1.0);
                    if r < p {
                        pick = Some(s);
                        break;
                    }
                    r -= p;
                }
                let Some(s) = pick else { continue };
                let top = top_of(c.h);
                if Self::liquid(m, &c, top).0 > top || self.protected(bx, bz, 3) {
                    continue;
                }
                let mut rng = Rng::new(((h as u64) << 32) | hash32(h ^ 0x4321) as u64);
                let radius = (0.62 * (s.size as f32).cbrt() + 0.25).min(3.0) * (0.85 + rng.f() * 0.3);
                let cy = top as f32 + if s.mode == SCATTER_ON { radius * 0.35 } else { -radius * 0.45 };
                let ri = radius.ceil() as i32;
                for dy in -ri..=ri {
                    for dz in -ri..=ri {
                        for dx in -ri..=ri {
                            let y = cy.round() as i32 + dy;
                            let d = (dx * dx + dz * dz) as f32 + (dy * dy) as f32 * 1.3;
                            if d > radius * radius - rng.f() * 0.9 {
                                continue;
                            }
                            let (lx, lz) = (bx + dx - x0, bz + dz - z0);
                            if !(0..W as i32).contains(&lx) || !(0..W as i32).contains(&lz) || !(1..H as i32 - 1).contains(&y) {
                                continue;
                            }
                            let i = bidx(lx as usize, y as usize, lz as usize);
                            let cur = self.blocks[i];
                            if cur != WATER_B && cur != LAVA_B && cur != ICE_B {
                                self.blocks[i] = s.block;
                            }
                        }
                    }
                }
            }
        }
    }

    /// Single blocks on the ground (plants, stones) and in it (patches of another ground).
    fn place_map_scatter(&mut self, x0: i32, z0: i32, m: &TerrainMap) {
        for lz in 0..W {
            for lx in 0..W {
                let ai = (lz + M as usize) * A + lx + M as usize;
                let c = self.mcols[ai];
                let zone = &m.zones[c.zone as usize];
                let top = self.tops[ai];
                if zone.scatter.is_empty() || self.wet[ai] || top >= H as i32 - 2 {
                    continue;
                }
                let (wx, wz) = (x0 + lx as i32, z0 + lz as i32);
                let at = bidx(lx, top as usize, lz);
                let above = bidx(lx, top as usize + 1, lz);
                let ground = self.blocks[at];
                if self.blocks[above] != AIR || ground == AIR || self.in_blueprint(wx, wz) || self.protected(wx, wz, 0) {
                    continue;
                }
                let mut r = unit(hash2(self.seed ^ 0x0e6e, wx, wz));
                for (k, s) in zone.scatter.iter().enumerate() {
                    if s.mode == SCATTER_UNDER || s.size > 1 || !self.in_clump(s, k, wx, wz) {
                        continue;
                    }
                    if r >= s.density {
                        r -= s.density;
                        continue;
                    }
                    if s.mode == SCATTER_IN {
                        self.blocks[at] = s.block;
                    } else if SHAPE[s.block as usize] != SHAPE_CROSS || ground == zone.top || ground == zone.fill {
                        // Plants take root in the zone's own soil, not on its rock.
                        self.blocks[above] = s.block;
                    }
                    break;
                }
            }
        }
    }

    /// A tree's block, if it lands in this chunk: logs go through leaves, plants and liquid,
    /// leaves only into air and plants.
    #[inline]
    #[allow(clippy::too_many_arguments)]
    fn put(&mut self, m: &TerrainMap, x0: i32, z0: i32, wx: i32, y: i32, wz: i32, b: u8, hard: bool) {
        let (lx, lz) = (wx - x0, wz - z0);
        if !(0..W as i32).contains(&lx) || !(0..W as i32).contains(&lz) || !(0..H as i32).contains(&y) {
            return;
        }
        let i = bidx(lx as usize, y as usize, lz as usize);
        let cur = self.blocks[i];
        if cur == AIR || SHAPE[cur as usize] == SHAPE_CROSS || (hard && (m.leafy[cur as usize] || SHAPE[cur as usize] == SHAPE_LIQUID)) {
            self.blocks[i] = b;
        }
    }

    fn place_map_trees(&mut self, x0: i32, z0: i32, m: &TerrainMap) {
        // (big shapes?, grid cell, how far a tree reaches from its trunk, hash salt)
        for (big, cell, reach, salt) in [(false, 6i32, 4i32, 0x7ee5u32), (true, 10, 8, 0xb167)] {
            for gz in (z0 - reach).div_euclid(cell)..=(z0 + W as i32 - 1 + reach).div_euclid(cell) {
                for gx in (x0 - reach).div_euclid(cell)..=(x0 + W as i32 - 1 + reach).div_euclid(cell) {
                    let h = hash2(self.seed ^ salt, gx, gz);
                    let tx = gx * cell + (h % cell as u32) as i32;
                    let tz = gz * cell + ((h >> 8) % cell as u32) as i32;
                    if tx < x0 - reach || tx >= x0 + W as i32 + reach || tz < z0 - reach || tz >= z0 + W as i32 + reach {
                        continue;
                    }
                    let c = self.map_col(m, x0, z0, tx, tz);
                    let zone = &m.zones[c.zone as usize];
                    if zone.trees.is_empty() {
                        continue;
                    }
                    // Density varies slowly inside a zone for natural clearings.
                    let clump = 0.65 + 0.35 * self.n_flower.n2(tx as f32 / 40.0, tz as f32 / 40.0);
                    let mut r = unit(hash32(h ^ 0xde5));
                    let mut pick = None;
                    for t in zone.trees.iter().filter(|t| t.big() == big) {
                        let p = t.density * clump;
                        if r < p {
                            pick = Some(t);
                            break;
                        }
                        r -= p;
                    }
                    let Some(t) = pick else { continue };
                    let top = top_of(c.h);
                    if top + t.hmax + 8 >= H as i32 || self.protected(tx, tz, 4) {
                        continue;
                    }
                    let (ltop, liquid) = Self::liquid(m, &c, top);
                    if ltop > top && (!t.wet || ltop - top > 2 || liquid != WATER_B) {
                        continue;
                    }
                    let mut slope: f32 = 0.0;
                    for (dx, dz) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                        slope = slope.max((self.map_col(m, x0, z0, tx + dx, tz + dz).h - c.h).abs());
                    }
                    if slope > 2.2 {
                        continue;
                    }
                    let mut rng = Rng::new(((h as u64) << 32) | hash32(h ^ 0x1234) as u64);
                    let height = rng.range(t.hmin, t.hmax);
                    let s = Shape { m, x0, z0, x: tx, y: top + 1, z: tz, log: t.log, leaves: t.leaves, h: height };
                    match t.shape {
                        TREE_OAK => self.map_oak(&s, &mut rng),
                        TREE_SPRUCE => self.map_spruce(&s, &mut rng),
                        TREE_BROAD => self.map_broad(&s, &mut rng),
                        TREE_COLUMN => self.map_trunk(&s, 0, s.h),
                        TREE_PALM => self.map_palm(&s, &mut rng),
                        TREE_JUNGLE => self.map_jungle(&s, &mut rng),
                        TREE_GIANT => self.map_giant(&s, &mut rng),
                        TREE_DEAD => self.map_dead(&s, &mut rng),
                        _ => self.map_bush(&s, &mut rng),
                    }
                }
            }
        }
    }

    fn log(&mut self, s: &Shape, dx: i32, dy: i32, dz: i32) {
        self.put(s.m, s.x0, s.z0, s.x + dx, s.y + dy, s.z + dz, s.log, true);
    }

    fn leaf(&mut self, s: &Shape, dx: i32, dy: i32, dz: i32) {
        self.put(s.m, s.x0, s.z0, s.x + dx, s.y + dy, s.z + dz, s.leaves, false);
    }

    fn map_trunk(&mut self, s: &Shape, from: i32, to: i32) {
        for dy in from..to {
            self.log(s, 0, dy, 0);
        }
    }

    /// A ragged ball of leaves, flattened by `squash` (1: round).
    #[allow(clippy::too_many_arguments)]
    fn leaf_blob(&mut self, s: &Shape, cx: i32, cy: i32, cz: i32, r: f32, squash: f32, rng: &mut Rng) {
        let ri = r.ceil() as i32;
        for dy in -ri..=ri {
            for dz in -ri..=ri {
                for dx in -ri..=ri {
                    let d = (dx * dx + dz * dz) as f32 + (dy * dy) as f32 * squash;
                    if d <= r * r - rng.f() * 1.5 {
                        self.leaf(s, cx + dx, cy + dy, cz + dz);
                    }
                }
            }
        }
    }

    fn map_oak(&mut self, s: &Shape, rng: &mut Rng) {
        for dy in -3..=0i32 {
            let r: i32 = if dy >= -1 { 1 } else { 2 };
            for dz in -r..=r {
                for dx in -r..=r {
                    let corner = dx.abs() == r && dz.abs() == r;
                    if corner && (dy == 0 || rng.chance(0.55)) {
                        continue;
                    }
                    self.leaf(s, dx, s.h + dy, dz);
                }
            }
        }
        self.map_trunk(s, 0, s.h);
    }

    fn map_spruce(&mut self, s: &Shape, rng: &mut Rng) {
        let bare = rng.range(1, 3);
        self.leaf(s, 0, s.h, 0);
        self.leaf(s, 0, s.h + 1, 0);
        let (mut r, mut max_r) = (0i32, 1i32);
        let mut dy = s.h - 1;
        while dy >= bare {
            for dz in -r..=r {
                for dx in -r..=r {
                    if r > 0 && dx.abs() == r && dz.abs() == r {
                        continue;
                    }
                    self.leaf(s, dx, dy, dz);
                }
            }
            if r >= max_r {
                r = 0;
                max_r = (max_r + 1).min(3);
            } else {
                r += 1;
            }
            dy -= 1;
        }
        self.map_trunk(s, 0, s.h);
    }

    fn map_broad(&mut self, s: &Shape, rng: &mut Rng) {
        self.leaf_blob(s, 0, s.h, 0, 3.0, 1.6, rng);
        for b in 0..rng.range(2, 3) {
            let ang = rng.f() * 6.283 + b as f32 * 2.1;
            let (bx, bz) = ((ang.cos() * 1.6).round() as i32, (ang.sin() * 1.6).round() as i32);
            let by = s.h - 3 - rng.range(0, 2);
            self.leaf_blob(s, bx, by + 1, bz, 2.3, 1.6, rng);
            self.log(s, bx.signum(), by, bz.signum());
        }
        self.map_trunk(s, 0, s.h);
    }

    fn map_dead(&mut self, s: &Shape, rng: &mut Rng) {
        self.map_trunk(s, 0, s.h);
        for _ in 0..rng.range(1, 2) {
            let (dx, dz) = [(1, 0), (-1, 0), (0, 1), (0, -1)][rng.range(0, 3) as usize];
            let dy = rng.range(s.h / 2, s.h - 1).max(1);
            self.log(s, dx, dy, dz);
            if rng.chance(0.5) {
                self.log(s, dx * 2, dy + 1, dz * 2);
            }
        }
    }

    fn map_bush(&mut self, s: &Shape, rng: &mut Rng) {
        self.leaf_blob(s, 0, s.h - 1, 0, 1.0 + s.h as f32 * 0.45, 1.8, rng);
        self.map_trunk(s, 0, (s.h - 1).max(1));
    }

    /// A leaning trunk under a star of drooping fronds.
    fn map_palm(&mut self, s: &Shape, rng: &mut Rng) {
        let (lx, lz) = [(1, 0), (-1, 0), (0, 1), (0, -1)][rng.range(0, 3) as usize];
        let lean = rng.range(0, 1);
        let bend = s.h * 2 / 3;
        for dy in 0..s.h {
            let o = if dy >= bend { lean } else { 0 };
            self.log(s, lx * o, dy, lz * o);
        }
        let (cx, cz) = (lx * lean, lz * lean);
        self.leaf(s, cx, s.h, cz);
        for (dx, dz) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            for k in 1..=3 {
                self.leaf(s, cx + dx * k, s.h - (k == 3) as i32, cz + dz * k);
            }
        }
        for (dx, dz) in [(1, 1), (-1, 1), (1, -1), (-1, -1)] {
            self.leaf(s, cx + dx, s.h, cz + dz);
            self.leaf(s, cx + dx * 2, s.h - 1, cz + dz * 2);
        }
    }

    /// A tall trunk under a wide flat canopy with hanging leaves, and a lower bough or two.
    fn map_jungle(&mut self, s: &Shape, rng: &mut Rng) {
        let wide = s.h >= 18;
        let r = (s.h as f32 / 3.4).clamp(2.6, 5.2);
        for (dy, k) in [(-1, 0.82f32), (0, 1.0), (1, 0.72), (2, 0.38)] {
            let rr = r * k;
            let ri = rr.ceil() as i32;
            for dz in -ri..=ri {
                for dx in -ri..=ri {
                    let d = (dx * dx + dz * dz) as f32;
                    let edge = rr * rr - rng.f() * rr * 1.2;
                    if d > edge {
                        continue;
                    }
                    self.leaf(s, dx, s.h + dy, dz);
                    // Leaves trail from the canopy's rim.
                    if dy == -1 && d > (rr - 1.3) * (rr - 1.3) && rng.chance(0.3) {
                        for v in 1..=rng.range(1, 3) {
                            self.leaf(s, dx, s.h + dy - v, dz);
                        }
                    }
                }
            }
        }
        if s.h >= 10 {
            for b in 0..rng.range(1, 2) {
                let ang = rng.f() * 6.283 + b as f32 * 2.6;
                let (ux, uz) = (ang.cos(), ang.sin());
                let by = s.h * rng.range(50, 72) / 100;
                for k in 1..=3 {
                    self.log(s, (ux * k as f32).round() as i32, by + k / 2, (uz * k as f32).round() as i32);
                }
                self.leaf_blob(s, (ux * 3.0).round() as i32, by + 2, (uz * 3.0).round() as i32, 2.2, 1.8, rng);
            }
        }
        for dy in 0..s.h {
            self.log(s, 0, dy, 0);
            if wide {
                self.log(s, 1, dy, 0);
                self.log(s, 0, dy, 1);
                self.log(s, 1, dy, 1);
            }
        }
    }

    /// A giant conifer: a thick trunk flared at the foot, bare for half its height, under tiers
    /// of boughs that narrow to a spire.
    fn map_giant(&mut self, s: &Shape, rng: &mut Rng) {
        let thick = s.h >= 20;
        // The trunk's middle: between its four logs if it's thick.
        let mid = if thick { 0.5f32 } else { 0.0 };
        let crown = s.h * rng.range(42, 55) / 100;
        self.leaf(s, 0, s.h, 0);
        self.leaf(s, 0, s.h + 1, 0);
        let (mut r, mut max_r) = (1.0f32, 2.0f32);
        let mut dy = s.h - 1;
        while dy >= crown {
            let ri = r.ceil() as i32 + 1;
            for dz in -ri..=ri {
                for dx in -ri..=ri {
                    let (ox, oz) = (dx as f32 - mid, dz as f32 - mid);
                    if ox * ox + oz * oz <= (r + 0.4) * (r + 0.4) - rng.f() * 1.2 {
                        self.leaf(s, dx, dy, dz);
                    }
                }
            }
            if r >= max_r {
                r = (max_r - 2.0).max(1.0);
                max_r = (max_r + 1.0).min(5.0);
                dy -= 1; // a gap of bare trunk between tiers
            } else {
                r += 1.0;
            }
            dy -= 1;
        }
        for dy in 0..s.h {
            self.log(s, 0, dy, 0);
            if thick {
                self.log(s, 1, dy, 0);
                self.log(s, 0, dy, 1);
                self.log(s, 1, dy, 1);
            }
        }
        if thick {
            for (dx, dz) in [(-1, 0), (-1, 1), (2, 0), (2, 1), (0, -1), (1, -1), (0, 2), (1, 2)] {
                for dy in -1..rng.range(1, 4) {
                    self.log(s, dx, dy, dz);
                }
            }
        }
    }

    /// Dry, fairly level land nearest the middle of the map.
    pub(super) fn find_map_spawn(&self, m: &TerrainMap) -> (i32, i32, i32) {
        let mx = m.origin[0] + m.width * m.cell / 2;
        let mz = m.origin[1] + m.depth * m.cell / 2;
        let reach = (m.width.max(m.depth) * m.cell / 2) as f32;
        for ring in 0..200i32 {
            let r = ring as f32 / 200.0 * reach;
            let steps = (ring * 8).max(1);
            for k in 0..steps {
                let a = k as f32 / steps as f32 * std::f32::consts::TAU;
                let (x, z) = (mx + (a.cos() * r) as i32, mz + (a.sin() * r) as i32);
                let c = self.map_column(m, x, z);
                let top = top_of(c.h);
                if top > SEA && Self::liquid(m, &c, top).0 < 0 && (self.map_column(m, x + 2, z).h - c.h).abs() < 2.0 && (self.map_column(m, x, z + 2).h - c.h).abs() < 2.0 {
                    return (x, top + 1, z);
                }
            }
        }
        (mx, top_of(self.map_column(m, mx, mz).h).max(SEA) + 1, mz)
    }
}

/// A tree being placed: where its foot is, what it's made of and how tall.
struct Shape<'a> {
    m: &'a TerrainMap,
    x0: i32,
    z0: i32,
    x: i32,
    y: i32,
    z: i32,
    log: u8,
    leaves: u8,
    h: i32,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A round island 512 across on a 64 x 64 map of 8-block cells: a hill in the middle with a
    /// lake of lava on top, a pond high on its side, forest round it and sand at the shore.
    fn island() -> TerrainMap {
        let (w, d) = (64i32, 64i32);
        let mut heights = vec![0u16; (w * d) as usize];
        let mut zones = vec![0u8; (w * d) as usize];
        let mut water = vec![0u8; (w * d) as usize];
        for j in 0..d {
            for i in 0..w {
                let (dx, dz) = ((i - 32) as f32, (j - 32) as f32);
                let r = (dx * dx + dz * dz).sqrt();
                let mut h = 40.0 + (26.0 - r).clamp(-2.0, 30.0) * 3.0;
                let k = (j * w + i) as usize;
                zones[k] = if h < 62.0 { 0 } else if h < 66.0 { 1 } else { 2 };
                if r < 3.0 {
                    h = 100.0;
                    water[k] = 104;
                    zones[k] = 3;
                }
                if (dx - 12.0).abs() < 1.5 && dz.abs() < 1.5 {
                    h = 76.0;
                    water[k] = 80;
                }
                heights[k] = (h * 256.0) as u16;
            }
        }
        let palette = format!(
            r#"[{{"top":{SAND},"fill":{SAND}}},
                {{"top":{SAND},"fill":{SAND},"trees":[{{"shape":{TREE_PALM},"h":[5,8],"density":0.3}}]}},
                {{"grass":[40,160,60],"trees":[{{"shape":{TREE_GIANT},"h":[28,40],"density":0.5,"log":{SPRUCE_LOG_B},"leaves":{SPRUCE_LEAVES_B}}},{{"shape":{TREE_OAK},"h":[4,6],"density":0.3}}],
                  "scatter":[{{"block":{FERN_B},"density":0.2}},{{"block":{COBBLESTONE},"density":0.004,"size":8}},{{"block":{GLOWSTONE_B},"density":0.3,"where":2,"size":6}}]}},
                {{"top":{OBSIDIAN_B},"fill":{OBSIDIAN_B},"liquid":{LAVA_B},"bed":{OBSIDIAN_B},"roughness":0.5}}]"#
        );
        TerrainMap::new([-256, -256], 8, w, d, &heights, &zones, &water, 30.0, 0, &palette).unwrap()
    }

    fn world(g: &mut Generator, c0: i32, c1: i32) -> crate::world::World {
        let mut w = crate::world::World::new();
        for cz in c0..c1 {
            for cx in c0..c1 {
                let d = g.generate(cx, cz);
                w.insert_column(cx, cz, &d);
            }
        }
        w
    }

    #[test]
    fn a_map_world_is_the_games_island() {
        let mut g = Generator::new(5);
        g.set_map(island());
        assert_eq!(g.generate(2, -3), g.generate(2, -3), "deterministic");
        let w = world(&mut g, -18, 18);
        let count = |b: u8, y0: i32, y1: i32| {
            let mut n = 0;
            for z in -280..280 {
                for x in -280..280 {
                    for y in y0..y1 {
                        n += (w.get(x, y, z) == b) as i32;
                    }
                }
            }
            n
        };
        // Outside the map and round the island: sea over the sea bed.
        assert_eq!(w.get(-280, SEA, -280), WATER_B);
        assert_eq!(w.get(-280, SEA + 1, -280), AIR);
        assert_ne!(w.get(-280, 25, -280), WATER_B);
        // The hill's top is a lake of lava, held in: none runs down the sides.
        assert_eq!(w.get(0, 104, 0), LAVA_B);
        assert_eq!(w.get(0, 105, 0), AIR);
        assert_eq!(count(LAVA_B, 80, 99) + count(LAVA_B, 105, 130), 0, "lava stays in its lake");
        // The pond on the hillside: water at its level, well above the sea.
        assert_eq!(w.get(96, 80, 0), WATER_B);
        assert_eq!(w.get(96, 81, 0), AIR);
        assert_eq!(count(WATER_B, 81, 140), 0, "no water above the pond's level");
        // The zones' trees and scatter are there: giant conifers, palms, ferns, boulders, veins.
        assert!(count(SPRUCE_LOG_B, 64, 150) > 2000, "giant trees");
        assert!((90..150).any(|y| (-200..200).any(|x| w.get(x, y, x / 3) == SPRUCE_LEAVES_B)), "tall crowns");
        assert!(count(FERN_B, 64, 120) > 500);
        assert!(count(COBBLESTONE, 60, 120) > 20);
        assert!(count(GLOWSTONE_B, 5, 60) > 200);
        assert!(count(OAK_LOG_B, 63, 80) > 50, "palms and oaks");
    }

    #[test]
    fn big_trees_agree_across_chunk_borders() {
        // A giant tree's blocks come from every chunk it reaches into: generating the same
        // chunk alone or after its neighbours gives the same bytes, and crowns aren't cut off
        // at borders (a leaf at a border has its neighbour across it).
        let mut g = Generator::new(11);
        g.set_map(island());
        let w = world(&mut g, 2, 8);
        let mut cut = 0;
        let mut seen = 0;
        for z in 40..120 {
            for y in 80..140 {
                // x = 63 | 64 is a chunk border.
                let (a, b) = (w.get(63, y, z), w.get(64, y, z));
                if a == SPRUCE_LEAVES_B || b == SPRUCE_LEAVES_B {
                    seen += 1;
                    cut += (a == AIR || b == AIR) as i32;
                }
            }
        }
        assert!(seen > 30, "crowns cross the border: {seen}");
        assert!(cut * 3 < seen, "crowns aren't sliced at the border: {cut} of {seen}");
    }

    #[test]
    fn map_timing() {
        let mut g = Generator::new(1337);
        g.set_map(island());
        let t = std::time::Instant::now();
        let n = 64;
        for i in 0..n {
            std::hint::black_box(g.generate(i % 8 - 4, i / 8 - 4));
        }
        eprintln!("generate (map): {:.3} ms/chunk (native)", t.elapsed().as_secs_f64() * 1000.0 / n as f64);
    }
}
