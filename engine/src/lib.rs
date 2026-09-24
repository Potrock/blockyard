//! Voxel engine compute core compiled to WebAssembly: terrain generation, lighting, meshing,
//! physics, raycasting, visibility culling and shadow-camera math.

use wasm_bindgen::prelude::*;

pub mod blocks;
pub mod cull;
pub mod entities;
pub mod entitytex;
pub mod gen;
pub mod mesher;
pub mod noise;
pub mod noisetex;
pub mod texgen;
pub mod world;

#[cfg(test)]
pub mod testutil;

#[wasm_bindgen]
pub fn block_registry_json() -> String {
    blocks::registry_json()
}

/// Albedo layers followed by material layers (see `texgen`).
#[wasm_bindgen]
pub fn generate_textures() -> Vec<u8> {
    let (mut a, m) = texgen::generate();
    a.extend_from_slice(&m);
    a
}

/// Built-in entity atlas (monster skins + item sprites): 256x256 RGBA albedo followed by
/// 256x256 single-channel emissive.
#[wasm_bindgen]
pub fn entity_textures() -> Vec<u8> {
    let (mut a, e) = entitytex::generate();
    a.extend_from_slice(&e);
    a
}

#[wasm_bindgen]
pub fn texture_layer_count() -> u32 {
    blocks::tex::COUNT as u32
}

#[wasm_bindgen]
pub fn noise_texture(size: u32) -> Vec<u8> {
    noisetex::generate(size as usize)
}

#[wasm_bindgen]
pub fn sea_level() -> i32 {
    gen::SEA
}

#[wasm_bindgen]
pub fn mesh_header_words() -> u32 {
    mesher::MESH_HEADER as u32
}

#[wasm_bindgen]
pub fn chunk_header_bytes() -> u32 {
    gen::HEADER_BYTES as u32
}

/// Stateless terrain generator (one per worker).
#[wasm_bindgen]
pub struct TerrainGen {
    inner: gen::Generator,
}

#[wasm_bindgen]
impl TerrainGen {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32) -> TerrainGen {
        TerrainGen { inner: gen::Generator::new(seed) }
    }

    pub fn generate(&mut self, cx: i32, cz: i32) -> Vec<u8> {
        self.inner.generate(cx, cz)
    }

    /// Stamp a game structure during generation. `data` is (y * sz + z) * sx + x; 255 = keep.
    #[allow(clippy::too_many_arguments)]
    pub fn add_blueprint(&mut self, ox: i32, oy: i32, oz: i32, sx: i32, sy: i32, sz: i32, data: &[u8]) {
        self.inner.add_blueprint(gen::Blueprint { origin: [ox, oy, oz], size: [sx, sy, sz], data: data.to_vec() });
    }

    /// Flatten terrain to `height` inside `radius`, blending over `blend` blocks.
    pub fn add_terraform(&mut self, cx: f32, cz: f32, radius: f32, blend: f32, height: f32) {
        self.inner.add_terraform(gen::Terraform { cx, cz, radius, blend, height });
    }

    pub fn set_flat(&mut self, height: f32) {
        self.inner.set_flat(height);
    }

    pub fn set_void(&mut self) {
        self.inner.set_void();
    }

    /// [x, y, z] of a pleasant spawn column.
    pub fn find_spawn(&self) -> Vec<i32> {
        let (x, y, z) = self.inner.find_spawn();
        vec![x, y, z]
    }
}

/// Lighting + meshing (one per worker).
#[wasm_bindgen]
pub struct ChunkMesher {
    inner: mesher::Mesher,
}

#[wasm_bindgen]
impl ChunkMesher {
    #[wasm_bindgen(constructor)]
    pub fn new() -> ChunkMesher {
        ChunkMesher { inner: mesher::Mesher::new() }
    }

    pub fn mesh(&mut self, region: &[u8]) -> Vec<u32> {
        self.inner.mesh(region)
    }
}

impl Default for ChunkMesher {
    fn default() -> Self {
        Self::new()
    }
}

/// Main-thread world: block storage, edits, raycasts and the player's physics body.
#[wasm_bindgen]
pub struct VoxelWorld {
    inner: world::World,
    player: world::Player,
    entities: entities::Entities,
}

#[wasm_bindgen]
impl VoxelWorld {
    #[wasm_bindgen(constructor)]
    pub fn new() -> VoxelWorld {
        VoxelWorld { inner: world::World::new(), player: world::Player::new(0.0, 100.0, 0.0), entities: entities::Entities::new(160, 320) }
    }

    pub fn insert_column(&mut self, cx: i32, cz: i32, data: &[u8]) {
        self.inner.insert_column(cx, cz, data);
    }

    pub fn remove_column(&mut self, cx: i32, cz: i32) {
        self.inner.remove_column(cx, cz);
    }

    pub fn has_column(&self, cx: i32, cz: i32) -> bool {
        self.inner.has_column(cx, cz)
    }

    pub fn column_count(&self) -> u32 {
        self.inner.column_count() as u32
    }

    /// Block id; 255 when the column is not loaded.
    pub fn get_block(&self, x: i32, y: i32, z: i32) -> u8 {
        self.inner.get_or(x, y, z, 255)
    }

    pub fn set_block(&mut self, x: i32, y: i32, z: i32, b: u8) -> bool {
        self.inner.set(x, y, z, b)
    }

    pub fn extract_region(&self, cx: i32, cz: i32) -> Vec<u8> {
        self.inner.extract_region(cx, cz)
    }

    pub fn export_edits(&self) -> Vec<u8> {
        self.inner.export_edits()
    }

    pub fn import_edits(&mut self, data: &[u8]) {
        self.inner.import_edits(data);
    }

    pub fn clear_edits(&mut self) {
        self.inner.clear_edits();
    }

    /// Undo this session's edits; returns the loaded columns that changed as [cx, cz, ...].
    pub fn revert_edits(&mut self) -> Vec<i32> {
        self.inner.revert_edits()
    }

    pub fn edit_count(&self) -> u32 {
        self.inner.edit_count() as u32
    }

    /// [hit, bx, by, bz, nx, ny, nz, block]
    #[allow(clippy::too_many_arguments)]
    pub fn raycast(&self, ox: f64, oy: f64, oz: f64, dx: f64, dy: f64, dz: f64, max_dist: f64) -> Vec<i32> {
        match self.inner.raycast([ox, oy, oz], [dx, dy, dz], max_dist) {
            Some((p, n, b)) => vec![1, p[0], p[1], p[2], n[0], n[1], n[2], b as i32],
            None => vec![0; 8],
        }
    }

    pub fn player_reset(&mut self, x: f64, y: f64, z: f64) {
        let flying = self.player.flying;
        self.player = world::Player::new(x, y, z);
        self.player.flying = flying;
    }

    pub fn set_flying(&mut self, on: bool) {
        self.player.flying = on;
        if on {
            self.player.vel[1] = self.player.vel[1].max(0.0);
        }
    }

    pub fn set_frozen(&mut self, on: bool) {
        self.player.frozen = on;
    }

    pub fn player_step(&mut self, wish_x: f64, wish_z: f64, jump: bool, sneak: bool, sprint: bool, dt: f64) {
        let input = world::MoveInput { wish_x, wish_z, jump, sneak, sprint };
        self.player.step(&self.inner, &input, dt);
    }

    /// [x, y, z, vx, vy, vz, on_ground, in_water, eyes_in_water, in_lava, flying, bob]
    pub fn player_state(&self) -> Vec<f64> {
        let p = &self.player;
        vec![
            p.pos[0],
            p.pos[1],
            p.pos[2],
            p.vel[0],
            p.vel[1],
            p.vel[2],
            p.on_ground as u8 as f64,
            p.in_water as u8 as f64,
            p.eyes_in_water as u8 as f64,
            p.in_lava as u8 as f64,
            p.flying as u8 as f64,
            p.bob,
        ]
    }

    /// [sky, block] light estimate (0..1) at a block position.
    pub fn light_probe(&self, x: i32, y: i32, z: i32) -> Vec<f32> {
        let (s, b) = self.inner.light_probe(x, y, z);
        vec![s, b]
    }

    /// Add a velocity change to the player (knockback, launch pads).
    pub fn player_impulse(&mut self, vx: f64, vy: f64, vz: f64) {
        self.player.impulse([vx, vy, vz]);
    }

    // ---- Entity simulation (see `entities.rs` for the buffer layouts) ----

    pub fn bodies_ptr(&self) -> u32 {
        self.entities.bodies.as_ptr() as u32
    }

    pub fn body_capacity(&self) -> u32 {
        self.entities.body_capacity() as u32
    }

    pub fn body_stride(&self) -> u32 {
        entities::body::STRIDE as u32
    }

    pub fn projectiles_ptr(&self) -> u32 {
        self.entities.projectiles.as_ptr() as u32
    }

    pub fn projectile_capacity(&self) -> u32 {
        self.entities.projectile_capacity() as u32
    }

    pub fn projectile_stride(&self) -> u32 {
        entities::proj::STRIDE as u32
    }

    /// Advance bodies (navigation, physics, separation) and projectiles.
    pub fn step_entities(&mut self, dt: f64) {
        let p = self.player.pos;
        self.entities.step_bodies(&self.inner, dt, p, world::HALF_W, world::HEIGHT);
        self.entities.step_projectiles(&self.inner, dt, p, world::HALF_W, world::HEIGHT);
    }

    /// Force a navigation-field rebuild toward the player now.
    pub fn rebuild_flow(&mut self) {
        let p = self.player.pos;
        self.entities.rebuild_flow(&self.inner, p);
    }

    /// [body index or -1, distance] for the first body hit by a ray before any solid block.
    #[allow(clippy::too_many_arguments)]
    pub fn pick_body(&self, ox: f64, oy: f64, oz: f64, dx: f64, dy: f64, dz: f64, max_dist: f64, pad: f64) -> Vec<f64> {
        match self.entities.pick_body(&self.inner, [ox, oy, oz], [dx, dy, dz], max_dist, pad) {
            Some((i, t)) => vec![i as f64, t],
            None => vec![-1.0, 0.0],
        }
    }

    /// Whether the segment between two points is free of solid blocks.
    #[allow(clippy::too_many_arguments)]
    pub fn line_clear(&self, ax: f64, ay: f64, az: f64, bx: f64, by: f64, bz: f64) -> bool {
        entities::line_clear(&self.inner, [ax, ay, az], [bx, by, bz])
    }

    /// Whether a unit block at (x, y, z) would overlap the player's body.
    pub fn player_overlaps(&self, x: i32, y: i32, z: i32) -> bool {
        let p = &self.player.pos;
        let (x0, x1) = (p[0] - world::HALF_W, p[0] + world::HALF_W);
        let (y0, y1) = (p[1], p[1] + world::HEIGHT);
        let (z0, z1) = (p[2] - world::HALF_W, p[2] + world::HALF_W);
        (x as f64) < x1 && (x + 1) as f64 > x0 && (y as f64) < y1 && (y + 1) as f64 > y0 && (z as f64) < z1 && (z + 1) as f64 > z0
    }
}

impl Default for VoxelWorld {
    fn default() -> Self {
        Self::new()
    }
}

/// Visibility culling over registered chunk meshes.
#[wasm_bindgen]
pub struct Culler {
    inner: cull::Culler,
}

#[wasm_bindgen]
impl Culler {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Culler {
        Culler { inner: cull::Culler::new() }
    }

    pub fn set_column(&mut self, cx: i32, cz: i32, header: &[u32]) -> u32 {
        self.inner.set_column(cx, cz, header) as u32
    }

    pub fn remove_column(&mut self, cx: i32, cz: i32) {
        self.inner.remove_column(cx, cz);
    }

    pub fn cull(&mut self, vp: &[f64], cx: f64, cy: f64, cz: f64, radius: i32, occlusion: bool) {
        self.inner.cull(vp, [cx, cy, cz], radius, occlusion);
    }

    pub fn cull_shadow(&mut self, vp: &[f64], cx: f64, cy: f64, cz: f64, radius: i32) {
        self.inner.cull_shadow(vp, [cx, cy, cz], radius);
    }

    /// Slot capacity; output arrays hold 6 (main) / 4 (shadow) words per slot.
    pub fn capacity(&self) -> u32 {
        self.inner.capacity() as u32
    }

    pub fn out_ptr(&self) -> u32 {
        self.inner.out.as_ptr() as u32
    }

    pub fn out_shadow_ptr(&self) -> u32 {
        self.inner.out_shadow.as_ptr() as u32
    }

    pub fn visible_sections(&self) -> u32 {
        self.inner.visible_sections
    }
}

impl Default for Culler {
    fn default() -> Self {
        Self::new()
    }
}

/// View (16) + projection (16) matrices of a texel-snapped orthographic shadow camera.
#[wasm_bindgen]
pub fn shadow_camera(to_sun: &[f64], center: &[f64], radius: f64, depth: f64, resolution: f64) -> Vec<f64> {
    cull::shadow_camera([to_sun[0], to_sun[1], to_sun[2]], [center[0], center[1], center[2]], radius, depth, resolution).to_vec()
}
