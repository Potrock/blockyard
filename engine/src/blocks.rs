//! Block registry: ids, render / physics / light properties and texture layers.
//!
//! Face order used everywhere in the engine: 0 = +X, 1 = -X, 2 = +Y, 3 = -Y, 4 = +Z, 5 = -Z.
//!
//! A block id is one byte, and a block with orientations or parts (a torch on a wall, the head
//! of a bed facing east, the top half of a slab) has one id per variant. Every variant of a family
//! shares the family's `name` and differs in its `state` (`"facing=east,part=head"`), the way
//! Minecraft writes block states. Ids never change once given out: saved worlds store them.

/// Texture array layers. Order here is the order of layers in the generated texture array.
pub mod tex {
    pub const STONE: u16 = 0;
    pub const GRASS_TOP: u16 = 1;
    pub const GRASS_SIDE: u16 = 2;
    pub const DIRT: u16 = 3;
    pub const COBBLESTONE: u16 = 4;
    pub const OAK_PLANKS: u16 = 5;
    pub const BEDROCK: u16 = 6;
    pub const SAND: u16 = 7;
    pub const GRAVEL: u16 = 8;
    pub const OAK_LOG: u16 = 9;
    pub const OAK_LOG_TOP: u16 = 10;
    pub const OAK_LEAVES: u16 = 11;
    pub const GLASS: u16 = 12;
    pub const WATER: u16 = 13;
    pub const LAVA: u16 = 14;
    pub const SANDSTONE: u16 = 15;
    pub const SANDSTONE_TOP: u16 = 16;
    pub const SNOW: u16 = 17;
    pub const ICE: u16 = 18;
    pub const COAL_ORE: u16 = 19;
    pub const IRON_ORE: u16 = 20;
    pub const GOLD_ORE: u16 = 21;
    pub const DIAMOND_ORE: u16 = 22;
    pub const REDSTONE_ORE: u16 = 23;
    pub const LAPIS_ORE: u16 = 24;
    pub const BIRCH_LOG: u16 = 25;
    pub const BIRCH_LOG_TOP: u16 = 26;
    pub const BIRCH_LEAVES: u16 = 27;
    pub const SPRUCE_LOG: u16 = 28;
    pub const SPRUCE_LOG_TOP: u16 = 29;
    pub const SPRUCE_LEAVES: u16 = 30;
    pub const CACTUS_SIDE: u16 = 31;
    pub const CACTUS_TOP: u16 = 32;
    pub const SHORT_GRASS: u16 = 33;
    pub const FERN: u16 = 34;
    pub const DANDELION: u16 = 35;
    pub const POPPY: u16 = 36;
    pub const CORNFLOWER: u16 = 37;
    pub const DEAD_BUSH: u16 = 38;
    pub const GLOWSTONE: u16 = 39;
    pub const BRICKS: u16 = 40;
    pub const STONE_BRICKS: u16 = 41;
    pub const MOSSY_COBBLESTONE: u16 = 42;
    pub const CLAY: u16 = 43;
    pub const GRASS_SNOW_SIDE: u16 = 44;
    pub const OBSIDIAN: u16 = 45;
    pub const BOOKSHELF: u16 = 46;
    pub const TORCH: u16 = 47;
    pub const GRANITE: u16 = 48;
    pub const DIORITE: u16 = 49;
    pub const ANDESITE: u16 = 50;
    pub const DEEPSLATE: u16 = 51;
    pub const DEEPSLATE_TOP: u16 = 52;
    pub const PODZOL_TOP: u16 = 53;
    pub const PODZOL_SIDE: u16 = 54;
    pub const WHITE_WOOL: u16 = 55;
    pub const RED_WOOL: u16 = 56;
    pub const YELLOW_WOOL: u16 = 57;
    pub const GREEN_WOOL: u16 = 58;
    pub const BLUE_WOOL: u16 = 59;
    pub const BLACK_WOOL: u16 = 60;
    pub const SEA_LANTERN: u16 = 61;
    pub const SPRUCE_PLANKS: u16 = 62;
    pub const BIRCH_PLANKS: u16 = 63;
    pub const BROWN_MUSHROOM: u16 = 64;
    pub const RED_MUSHROOM: u16 = 65;
    pub const WHITE_CONCRETE: u16 = 66;
    pub const LIGHT_GRAY_CONCRETE: u16 = 67;
    pub const GRAY_CONCRETE: u16 = 68;
    pub const BLACK_CONCRETE: u16 = 69;
    pub const RED_CONCRETE: u16 = 70;
    pub const IRON_BLOCK: u16 = 71;
    pub const END_STONE: u16 = 72;
    pub const RED_BED_HEAD_TOP: u16 = 73;
    pub const RED_BED_HEAD_SIDE: u16 = 74;
    pub const BLUE_BED_HEAD_TOP: u16 = 75;
    pub const BLUE_BED_HEAD_SIDE: u16 = 76;
    pub const GREEN_BED_HEAD_TOP: u16 = 77;
    pub const GREEN_BED_HEAD_SIDE: u16 = 78;
    pub const YELLOW_BED_HEAD_TOP: u16 = 79;
    pub const YELLOW_BED_HEAD_SIDE: u16 = 80;
    pub const RED_BED_FOOT_TOP: u16 = 81;
    pub const RED_BED_FOOT_SIDE: u16 = 82;
    pub const RED_BED_HEAD_END: u16 = 83;
    pub const RED_BED_FOOT_END: u16 = 84;
    pub const BLUE_BED_FOOT_TOP: u16 = 85;
    pub const BLUE_BED_FOOT_SIDE: u16 = 86;
    pub const BLUE_BED_HEAD_END: u16 = 87;
    pub const BLUE_BED_FOOT_END: u16 = 88;
    pub const GREEN_BED_FOOT_TOP: u16 = 89;
    pub const GREEN_BED_FOOT_SIDE: u16 = 90;
    pub const GREEN_BED_HEAD_END: u16 = 91;
    pub const GREEN_BED_FOOT_END: u16 = 92;
    pub const YELLOW_BED_FOOT_TOP: u16 = 93;
    pub const YELLOW_BED_FOOT_SIDE: u16 = 94;
    pub const YELLOW_BED_HEAD_END: u16 = 95;
    pub const YELLOW_BED_FOOT_END: u16 = 96;
    pub const WALL_TORCH: u16 = 97;

    pub const COUNT: usize = 98;

    pub const NAMES: [&str; COUNT] = [
        "stone", "grass_top", "grass_side", "dirt", "cobblestone", "oak_planks", "bedrock", "sand",
        "gravel", "oak_log", "oak_log_top", "oak_leaves", "glass", "water", "lava", "sandstone",
        "sandstone_top", "snow", "ice", "coal_ore", "iron_ore", "gold_ore", "diamond_ore",
        "redstone_ore", "lapis_ore", "birch_log", "birch_log_top", "birch_leaves", "spruce_log",
        "spruce_log_top", "spruce_leaves", "cactus_side", "cactus_top", "short_grass", "fern",
        "dandelion", "poppy", "cornflower", "dead_bush", "glowstone", "bricks", "stone_bricks",
        "mossy_cobblestone", "clay", "grass_snow_side", "obsidian", "bookshelf", "torch", "granite",
        "diorite", "andesite", "deepslate", "deepslate_top", "podzol_top", "podzol_side",
        "white_wool", "red_wool", "yellow_wool", "green_wool", "blue_wool", "black_wool",
        "sea_lantern", "spruce_planks", "birch_planks", "brown_mushroom", "red_mushroom",
        "white_concrete", "light_gray_concrete", "gray_concrete", "black_concrete", "red_concrete", "iron_block",
        "end_stone", "red_bed_head_top", "red_bed_head_side", "blue_bed_head_top", "blue_bed_head_side",
        "green_bed_head_top", "green_bed_head_side", "yellow_bed_head_top", "yellow_bed_head_side",
        "red_bed_foot_top", "red_bed_foot_side", "red_bed_head_end", "red_bed_foot_end",
        "blue_bed_foot_top", "blue_bed_foot_side", "blue_bed_head_end", "blue_bed_foot_end",
        "green_bed_foot_top", "green_bed_foot_side", "green_bed_head_end", "green_bed_foot_end",
        "yellow_bed_foot_top", "yellow_bed_foot_side", "yellow_bed_head_end", "yellow_bed_foot_end",
        "wall_torch",
    ];
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Shape {
    Air,
    /// Full cube.
    Cube,
    /// Two diagonal quads (plants).
    Cross,
    /// Full cube with a lowered surface when exposed (water, lava).
    Liquid,
    /// Boxes on a 1/16 grid (torches, slabs, stairs, beds): see `ModelKind` and `shapes`.
    Model,
}

/// What a `Shape::Model` block looks like (built in `shapes`). Facings: 0 north (-Z), 1 east
/// (+X), 2 south (+Z), 3 west (-X).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ModelKind {
    None,
    /// A standing torch. `tex[0]`: the torch; `tex[3]`: its underside.
    Torch,
    /// A torch on a wall, pointing toward the facing (the wall is behind it). `tex[0]`: the
    /// wall torch texture; `tex[3]`: its underside.
    WallTorch(u8),
    /// Half a block; true = the upper half. Faces use `tex` by direction.
    Slab(bool),
    /// Stairs climbing toward the facing; true = upside down. Faces use `tex` by direction.
    Stairs(u8, bool),
    /// Half of a bed whose head points toward the facing; true = the head half.
    /// `tex`: [top, side, end, underside, legs, -].
    Bed(u8, bool),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Layer {
    Opaque = 0,
    Cutout = 1,
    Translucent = 2,
}

/// Texture transforms (`Block::uvt`, and per face of a model): swap u and v, then negate u,
/// then negate v. Together they make the 8 rotations and mirror images of a texture.
pub const UV_SWAP: u8 = 1;
pub const UV_NEG_U: u8 = 2;
pub const UV_NEG_V: u8 = 4;

#[derive(Clone, Copy)]
pub struct Block {
    /// The family name, shared by all its variants (`red_bed`).
    pub name: &'static str,
    pub label: &'static str,
    /// Which variant of the family (`facing=east,part=head`); empty for the default of a plain block.
    pub state: &'static str,
    pub shape: Shape,
    pub model: ModelKind,
    pub layer: Layer,
    /// Texture layer per face: +X -X +Y -Y +Z -Z (models: see `ModelKind`).
    pub tex: [u16; 6],
    /// Texture transform per face (`UV_*`), for cubes (a log lying on its side).
    pub uvt: [u8; 6],
    /// Full opaque cube: hides neighbour faces, casts ambient occlusion, blocks all light.
    pub opaque: bool,
    /// Collides with entities.
    pub solid: bool,
    /// Light attenuation when light passes through (0..=15). Opaque blocks use 15. A model that
    /// blocks light (a slab) still gets light itself, from its neighbours.
    pub opacity: u8,
    /// Light emission (0..=15).
    pub emit: u8,
    /// Multiply by biome colour (grass, foliage).
    pub tint: bool,
    /// Vertex animation: 0 none, 1 leaves sway, 2 plant sway (top vertices).
    pub anim: u8,
    /// Hide faces between two blocks of the same type (glass).
    pub cull_self: bool,
    /// Leaves-style block: faces toward other leaves are kept (fancy leaves).
    pub leaves: bool,
    /// Can be replaced by placing a block into it (plants, liquids).
    pub replaceable: bool,
    /// Shown in the creative inventory (one variant per family).
    pub placeable: bool,
    /// A slab: the block two halves make together.
    pub double: u8,
}

const fn base(name: &'static str, label: &'static str, t: [u16; 6]) -> Block {
    Block {
        name,
        label,
        state: "",
        shape: Shape::Cube,
        model: ModelKind::None,
        layer: Layer::Opaque,
        tex: t,
        uvt: [0; 6],
        opaque: true,
        solid: true,
        opacity: 15,
        emit: 0,
        tint: false,
        anim: 0,
        cull_self: false,
        leaves: false,
        replaceable: false,
        placeable: true,
        double: 0,
    }
}

const fn cube(name: &'static str, label: &'static str, t: u16) -> Block {
    base(name, label, [t, t, t, t, t, t])
}

const fn cube3(name: &'static str, label: &'static str, top: u16, side: u16, bottom: u16) -> Block {
    base(name, label, [side, side, top, bottom, side, side])
}

const fn leaves(name: &'static str, label: &'static str, t: u16, tint: bool) -> Block {
    Block {
        layer: Layer::Cutout,
        opaque: false,
        opacity: 1,
        tint,
        anim: 1,
        leaves: true,
        ..cube(name, label, t)
    }
}

const fn plant(name: &'static str, label: &'static str, t: u16, tint: bool, anim: u8) -> Block {
    Block {
        shape: Shape::Cross,
        layer: Layer::Cutout,
        opaque: false,
        solid: false,
        opacity: 0,
        tint,
        anim,
        replaceable: true,
        ..cube(name, label, t)
    }
}

/// A model block: not a full cube, so it neither hides its neighbours' faces wholesale nor
/// darkens them; `opacity` 15 still keeps light out (slabs and stairs make roofs).
const fn model(b: Block, kind: ModelKind, state: &'static str, opacity: u8) -> Block {
    Block { shape: Shape::Model, model: kind, state, opaque: false, opacity, ..b }
}

use tex as T;

pub const AIR: u8 = 0;
pub const STONE: u8 = 1;
pub const GRASS: u8 = 2;
pub const DIRT: u8 = 3;
pub const COBBLESTONE: u8 = 4;
pub const OAK_PLANKS_B: u8 = 5;
pub const BEDROCK: u8 = 6;
pub const SAND: u8 = 7;
pub const GRAVEL: u8 = 8;
pub const OAK_LOG_B: u8 = 9;
pub const OAK_LEAVES_B: u8 = 10;
pub const GLASS_B: u8 = 11;
pub const WATER_B: u8 = 12;
pub const LAVA_B: u8 = 13;
pub const SANDSTONE_B: u8 = 14;
pub const SNOW_B: u8 = 15;
pub const ICE_B: u8 = 16;
pub const COAL_ORE_B: u8 = 17;
pub const IRON_ORE_B: u8 = 18;
pub const GOLD_ORE_B: u8 = 19;
pub const DIAMOND_ORE_B: u8 = 20;
pub const REDSTONE_ORE_B: u8 = 21;
pub const LAPIS_ORE_B: u8 = 22;
pub const BIRCH_LOG_B: u8 = 23;
pub const BIRCH_LEAVES_B: u8 = 24;
pub const SPRUCE_LOG_B: u8 = 25;
pub const SPRUCE_LEAVES_B: u8 = 26;
pub const CACTUS_B: u8 = 27;
pub const SHORT_GRASS_B: u8 = 28;
pub const FERN_B: u8 = 29;
pub const DANDELION_B: u8 = 30;
pub const POPPY_B: u8 = 31;
pub const CORNFLOWER_B: u8 = 32;
pub const DEAD_BUSH_B: u8 = 33;
pub const GLOWSTONE_B: u8 = 34;
pub const BRICKS_B: u8 = 35;
pub const STONE_BRICKS_B: u8 = 36;
pub const MOSSY_COBBLESTONE_B: u8 = 37;
pub const CLAY_B: u8 = 38;
pub const SNOWY_GRASS: u8 = 39;
pub const OBSIDIAN_B: u8 = 40;
pub const BOOKSHELF_B: u8 = 41;
pub const TORCH_B: u8 = 42;
pub const GRANITE_B: u8 = 43;
pub const DIORITE_B: u8 = 44;
pub const ANDESITE_B: u8 = 45;
pub const DEEPSLATE_B: u8 = 46;
pub const PODZOL: u8 = 47;
pub const WHITE_WOOL_B: u8 = 48;
pub const RED_WOOL_B: u8 = 49;
pub const YELLOW_WOOL_B: u8 = 50;
pub const GREEN_WOOL_B: u8 = 51;
pub const BLUE_WOOL_B: u8 = 52;
pub const BLACK_WOOL_B: u8 = 53;
pub const SEA_LANTERN_B: u8 = 54;
pub const SPRUCE_PLANKS_B: u8 = 55;
pub const BIRCH_PLANKS_B: u8 = 56;
pub const BROWN_MUSHROOM_B: u8 = 57;
pub const RED_MUSHROOM_B: u8 = 58;
pub const WHITE_CONCRETE_B: u8 = 59;
pub const LIGHT_GRAY_CONCRETE_B: u8 = 60;
pub const GRAY_CONCRETE_B: u8 = 61;
pub const BLACK_CONCRETE_B: u8 = 62;
pub const RED_CONCRETE_B: u8 = 63;
pub const IRON_BLOCK_B: u8 = 64;
pub const END_STONE_B: u8 = 65;
/// The foot of each bed facing north (red, blue, green, yellow); the other variants are at
/// `BED_VARIANTS` (see `bed_id`).
pub const RED_BED_B: u8 = 66;
pub const BLUE_BED_B: u8 = 67;
pub const GREEN_BED_B: u8 = 68;
pub const YELLOW_BED_B: u8 = 69;
/// Torches on walls, by facing (north, east, south, west).
pub const WALL_TORCH_B: u8 = 70;
/// Seven more variants of each bed colour.
pub const BED_VARIANTS: u8 = 74;
/// Slabs: bottom then top half, per `SLABS` material.
pub const SLAB_B: u8 = 102;
/// Stairs: per `STAIRS` material, per facing, the right way up then upside down.
pub const STAIRS_B: u8 = 118;
/// Logs lying along x, then along z, per `LOGS`.
pub const LOG_AXIS_B: u8 = 166;

pub const BLOCK_COUNT: usize = 172;

/// Horizontal facings in id order, and the face (+X -X +Y -Y +Z -Z order) each one points out of.
pub const FACING_NAMES: [&str; 4] = ["north", "east", "south", "west"];
pub const FACING_FACE: [usize; 4] = [5, 0, 4, 1];

pub const BED_COLORS: usize = 4;
/// Beds by colour: [head top, head side, head end, foot top, foot side, foot end].
const BED_TEX: [[u16; 6]; BED_COLORS] = [
    [T::RED_BED_HEAD_TOP, T::RED_BED_HEAD_SIDE, T::RED_BED_HEAD_END, T::RED_BED_FOOT_TOP, T::RED_BED_FOOT_SIDE, T::RED_BED_FOOT_END],
    [T::BLUE_BED_HEAD_TOP, T::BLUE_BED_HEAD_SIDE, T::BLUE_BED_HEAD_END, T::BLUE_BED_FOOT_TOP, T::BLUE_BED_FOOT_SIDE, T::BLUE_BED_FOOT_END],
    [T::GREEN_BED_HEAD_TOP, T::GREEN_BED_HEAD_SIDE, T::GREEN_BED_HEAD_END, T::GREEN_BED_FOOT_TOP, T::GREEN_BED_FOOT_SIDE, T::GREEN_BED_FOOT_END],
    [T::YELLOW_BED_HEAD_TOP, T::YELLOW_BED_HEAD_SIDE, T::YELLOW_BED_HEAD_END, T::YELLOW_BED_FOOT_TOP, T::YELLOW_BED_FOOT_SIDE, T::YELLOW_BED_FOOT_END],
];

/// Slab and stair materials: (family name, label, the full block they're cut from).
pub const SLABS: [(&str, &str, u8); 8] = [
    ("stone_slab", "Stone Slab", STONE),
    ("cobblestone_slab", "Cobblestone Slab", COBBLESTONE),
    ("oak_slab", "Oak Slab", OAK_PLANKS_B),
    ("spruce_slab", "Spruce Slab", SPRUCE_PLANKS_B),
    ("birch_slab", "Birch Slab", BIRCH_PLANKS_B),
    ("stone_brick_slab", "Stone Brick Slab", STONE_BRICKS_B),
    ("brick_slab", "Brick Slab", BRICKS_B),
    ("sandstone_slab", "Sandstone Slab", SANDSTONE_B),
];
pub const STAIRS: [(&str, &str, u8); 6] = [
    ("oak_stairs", "Oak Stairs", OAK_PLANKS_B),
    ("spruce_stairs", "Spruce Stairs", SPRUCE_PLANKS_B),
    ("birch_stairs", "Birch Stairs", BIRCH_PLANKS_B),
    ("cobblestone_stairs", "Cobblestone Stairs", COBBLESTONE),
    ("stone_brick_stairs", "Stone Brick Stairs", STONE_BRICKS_B),
    ("brick_stairs", "Brick Stairs", BRICKS_B),
];
pub const LOGS: [u8; 3] = [OAK_LOG_B, BIRCH_LOG_B, SPRUCE_LOG_B];

const FACING_STATES: [&str; 4] = ["facing=north", "facing=east", "facing=south", "facing=west"];
const BED_STATES: [&str; 8] = [
    "facing=north,part=foot",
    "facing=north,part=head",
    "facing=east,part=foot",
    "facing=east,part=head",
    "facing=south,part=foot",
    "facing=south,part=head",
    "facing=west,part=foot",
    "facing=west,part=head",
];
const SLAB_STATES: [&str; 2] = ["type=bottom", "type=top"];
const STAIR_STATES: [&str; 8] = [
    "facing=north,half=bottom",
    "facing=north,half=top",
    "facing=east,half=bottom",
    "facing=east,half=top",
    "facing=south,half=bottom",
    "facing=south,half=top",
    "facing=west,half=bottom",
    "facing=west,half=top",
];

pub const fn bed_id(color: u8, facing: u8, head: bool) -> u8 {
    let k = facing * 2 + head as u8;
    if k == 0 {
        RED_BED_B + color
    } else {
        BED_VARIANTS + color * 7 + k - 1
    }
}

pub const fn slab_id(material: u8, top: bool) -> u8 {
    SLAB_B + material * 2 + top as u8
}

pub const fn stairs_id(material: u8, facing: u8, top: bool) -> u8 {
    STAIRS_B + material * 8 + facing * 2 + top as u8
}

/// Axis 0 = x, 1 = z (a standing log is the log's own id).
pub const fn log_id(log: u8, axis: u8) -> u8 {
    LOG_AXIS_B + log * 2 + axis
}

const BASE: [Block; 70] = [
    Block {
        shape: Shape::Air,
        opaque: false,
        solid: false,
        opacity: 0,
        replaceable: true,
        placeable: false,
        ..cube("air", "Air", 0)
    },
    cube("stone", "Stone", T::STONE),
    Block { tint: true, ..base("grass_block", "Grass Block", [T::GRASS_SIDE, T::GRASS_SIDE, T::GRASS_TOP, T::DIRT, T::GRASS_SIDE, T::GRASS_SIDE]) },
    cube("dirt", "Dirt", T::DIRT),
    cube("cobblestone", "Cobblestone", T::COBBLESTONE),
    cube("oak_planks", "Oak Planks", T::OAK_PLANKS),
    Block { placeable: false, ..cube("bedrock", "Bedrock", T::BEDROCK) },
    cube("sand", "Sand", T::SAND),
    cube("gravel", "Gravel", T::GRAVEL),
    Block { state: "axis=y", ..cube3("oak_log", "Oak Log", T::OAK_LOG_TOP, T::OAK_LOG, T::OAK_LOG_TOP) },
    leaves("oak_leaves", "Oak Leaves", T::OAK_LEAVES, true),
    Block {
        layer: Layer::Cutout,
        opaque: false,
        opacity: 0,
        cull_self: true,
        ..cube("glass", "Glass", T::GLASS)
    },
    Block {
        shape: Shape::Liquid,
        layer: Layer::Translucent,
        opaque: false,
        solid: false,
        opacity: 1,
        replaceable: true,
        ..cube("water", "Water", T::WATER)
    },
    Block {
        shape: Shape::Liquid,
        layer: Layer::Opaque,
        opaque: false,
        solid: false,
        opacity: 15,
        emit: 15,
        replaceable: true,
        ..cube("lava", "Lava", T::LAVA)
    },
    cube3("sandstone", "Sandstone", T::SANDSTONE_TOP, T::SANDSTONE, T::SANDSTONE_TOP),
    cube("snow_block", "Snow", T::SNOW),
    cube("ice", "Ice", T::ICE),
    cube("coal_ore", "Coal Ore", T::COAL_ORE),
    cube("iron_ore", "Iron Ore", T::IRON_ORE),
    cube("gold_ore", "Gold Ore", T::GOLD_ORE),
    cube("diamond_ore", "Diamond Ore", T::DIAMOND_ORE),
    cube("redstone_ore", "Redstone Ore", T::REDSTONE_ORE),
    cube("lapis_ore", "Lapis Ore", T::LAPIS_ORE),
    Block { state: "axis=y", ..cube3("birch_log", "Birch Log", T::BIRCH_LOG_TOP, T::BIRCH_LOG, T::BIRCH_LOG_TOP) },
    leaves("birch_leaves", "Birch Leaves", T::BIRCH_LEAVES, false),
    Block { state: "axis=y", ..cube3("spruce_log", "Spruce Log", T::SPRUCE_LOG_TOP, T::SPRUCE_LOG, T::SPRUCE_LOG_TOP) },
    leaves("spruce_leaves", "Spruce Leaves", T::SPRUCE_LEAVES, false),
    cube3("cactus", "Cactus", T::CACTUS_TOP, T::CACTUS_SIDE, T::CACTUS_TOP),
    plant("short_grass", "Grass", T::SHORT_GRASS, true, 2),
    plant("fern", "Fern", T::FERN, true, 2),
    plant("dandelion", "Dandelion", T::DANDELION, false, 2),
    plant("poppy", "Poppy", T::POPPY, false, 2),
    plant("cornflower", "Cornflower", T::CORNFLOWER, false, 2),
    plant("dead_bush", "Dead Bush", T::DEAD_BUSH, false, 0),
    Block { emit: 15, ..cube("glowstone", "Glowstone", T::GLOWSTONE) },
    cube("bricks", "Bricks", T::BRICKS),
    cube("stone_bricks", "Stone Bricks", T::STONE_BRICKS),
    cube("mossy_cobblestone", "Mossy Cobblestone", T::MOSSY_COBBLESTONE),
    cube("clay", "Clay", T::CLAY),
    cube3("snowy_grass", "Snowy Grass", T::SNOW, T::GRASS_SNOW_SIDE, T::DIRT),
    cube("obsidian", "Obsidian", T::OBSIDIAN),
    cube3("bookshelf", "Bookshelf", T::OAK_PLANKS, T::BOOKSHELF, T::OAK_PLANKS),
    torch(),
    cube("granite", "Granite", T::GRANITE),
    cube("diorite", "Diorite", T::DIORITE),
    cube("andesite", "Andesite", T::ANDESITE),
    cube3("deepslate", "Deepslate", T::DEEPSLATE_TOP, T::DEEPSLATE, T::DEEPSLATE_TOP),
    cube3("podzol", "Podzol", T::PODZOL_TOP, T::PODZOL_SIDE, T::DIRT),
    cube("white_wool", "White Wool", T::WHITE_WOOL),
    cube("red_wool", "Red Wool", T::RED_WOOL),
    cube("yellow_wool", "Yellow Wool", T::YELLOW_WOOL),
    cube("green_wool", "Green Wool", T::GREEN_WOOL),
    cube("blue_wool", "Blue Wool", T::BLUE_WOOL),
    cube("black_wool", "Black Wool", T::BLACK_WOOL),
    Block { emit: 15, ..cube("sea_lantern", "Sea Lantern", T::SEA_LANTERN) },
    cube("spruce_planks", "Spruce Planks", T::SPRUCE_PLANKS),
    cube("birch_planks", "Birch Planks", T::BIRCH_PLANKS),
    plant("brown_mushroom", "Brown Mushroom", T::BROWN_MUSHROOM, false, 0),
    plant("red_mushroom", "Red Mushroom", T::RED_MUSHROOM, false, 0),
    cube("white_concrete", "White Concrete", T::WHITE_CONCRETE),
    cube("light_gray_concrete", "Light Gray Concrete", T::LIGHT_GRAY_CONCRETE),
    cube("gray_concrete", "Gray Concrete", T::GRAY_CONCRETE),
    cube("black_concrete", "Black Concrete", T::BLACK_CONCRETE),
    cube("red_concrete", "Red Concrete", T::RED_CONCRETE),
    cube("iron_block", "Block of Iron", T::IRON_BLOCK),
    cube("end_stone", "End Stone", T::END_STONE),
    bed(0, 0, false),
    bed(1, 0, false),
    bed(2, 0, false),
    bed(3, 0, false),
];

const fn torch() -> Block {
    let t = T::TORCH;
    Block {
        layer: Layer::Cutout,
        solid: false,
        emit: 14,
        ..model(base("torch", "Torch", [t, t, t, T::OAK_PLANKS, t, t]), ModelKind::Torch, "", 0)
    }
}

const fn wall_torch(facing: u8) -> Block {
    let t = T::WALL_TORCH;
    Block {
        layer: Layer::Cutout,
        solid: false,
        emit: 14,
        placeable: false,
        ..model(base("torch", "Torch", [t, t, t, T::OAK_PLANKS, t, t]), ModelKind::WallTorch(facing), FACING_STATES[facing as usize], 0)
    }
}

const BED_NAMES: [(&str, &str); BED_COLORS] = [("red_bed", "Red Bed"), ("blue_bed", "Blue Bed"), ("green_bed", "Green Bed"), ("yellow_bed", "Yellow Bed")];

const fn bed(color: usize, facing: u8, head: bool) -> Block {
    let t = &BED_TEX[color];
    let o = if head { 0 } else { 3 };
    let tex = [t[o], t[o + 1], t[o + 2], T::OAK_PLANKS, T::SPRUCE_PLANKS, 0];
    let (name, label) = BED_NAMES[color];
    Block {
        placeable: facing == 0 && !head,
        ..model(base(name, label, tex), ModelKind::Bed(facing, head), BED_STATES[(facing * 2 + head as u8) as usize], 0)
    }
}

pub static BLOCKS: [Block; BLOCK_COUNT] = build();

const fn build() -> [Block; BLOCK_COUNT] {
    let mut out = [BASE[0]; BLOCK_COUNT];
    let mut i = 0;
    while i < BASE.len() {
        out[i] = BASE[i];
        i += 1;
    }
    let mut f = 0u8;
    while f < 4 {
        out[(WALL_TORCH_B + f) as usize] = wall_torch(f);
        f += 1;
    }
    let mut c = 0u8;
    while c < BED_COLORS as u8 {
        let mut k = 1u8;
        while k < 8 {
            out[bed_id(c, k / 2, k % 2 == 1) as usize] = bed(c as usize, k / 2, k % 2 == 1);
            k += 1;
        }
        c += 1;
    }
    let mut m = 0;
    while m < SLABS.len() {
        let (name, label, full) = SLABS[m];
        let t = BASE[full as usize].tex;
        let mut top = 0;
        while top < 2 {
            out[slab_id(m as u8, top == 1) as usize] = Block {
                placeable: top == 0,
                double: full,
                ..model(base(name, label, t), ModelKind::Slab(top == 1), SLAB_STATES[top], 15)
            };
            top += 1;
        }
        m += 1;
    }
    let mut m = 0;
    while m < STAIRS.len() {
        let (name, label, full) = STAIRS[m];
        let t = BASE[full as usize].tex;
        let mut k = 0u8;
        while k < 8 {
            let (facing, top) = (k / 2, k % 2 == 1);
            out[stairs_id(m as u8, facing, top) as usize] = Block {
                placeable: k == 0,
                ..model(base(name, label, t), ModelKind::Stairs(facing, top), STAIR_STATES[k as usize], 15)
            };
            k += 1;
        }
        m += 1;
    }
    let mut l = 0;
    while l < LOGS.len() {
        let log = BASE[LOGS[l] as usize];
        let (top, side) = (log.tex[2], log.tex[0]);
        // Bark grain runs along the image's v: turn it to run along the log.
        let s = UV_SWAP;
        out[log_id(l as u8, 0) as usize] = Block { state: "axis=x", placeable: false, tex: [top, top, side, side, side, side], uvt: [0, 0, s, s, s, s], ..log };
        out[log_id(l as u8, 1) as usize] = Block { state: "axis=z", placeable: false, tex: [side, side, side, side, top, top], uvt: [s, s, 0, 0, 0, 0], ..log };
        l += 1;
    }
    out
}

const fn table<const F: u8>() -> [u8; 256] {
    let mut t = [0u8; 256];
    let mut i = 0;
    while i < BLOCK_COUNT {
        let b = &BLOCKS[i];
        t[i] = match F {
            0 => b.opaque as u8,
            1 => b.opacity,
            2 => b.emit,
            3 => b.solid as u8,
            4 => b.layer as u8,
            5 => match b.shape {
                Shape::Air => 0,
                Shape::Cube => 1,
                Shape::Cross => 2,
                Shape::Liquid => 3,
                Shape::Model => 4,
            },
            // Blocks light yet is lit itself: light reaches in but doesn't carry on through.
            6 => (!b.opaque && b.opacity >= 15 && matches!(b.shape, Shape::Model)) as u8,
            _ => 0,
        };
        i += 1;
    }
    // Unknown ids behave like stone so corrupted data never leaks light or holes.
    let mut j = BLOCK_COUNT;
    while j < 256 {
        t[j] = match F {
            0 => 1,
            1 => 15,
            3 => 1,
            5 => 1,
            _ => 0,
        };
        j += 1;
    }
    t
}

/// 1 when the block is a full opaque cube.
pub static OPAQUE: [u8; 256] = table::<0>();
/// Light attenuation (0..=15).
pub static OPACITY: [u8; 256] = table::<1>();
/// Light emission (0..=15).
pub static EMIT: [u8; 256] = table::<2>();
/// 1 when the block collides with entities.
pub static SOLID: [u8; 256] = table::<3>();
/// Render layer (see [`Layer`]).
pub static LAYER: [u8; 256] = table::<4>();
/// Shape id: 0 air, 1 cube, 2 cross, 3 liquid, 4 model.
pub static SHAPE: [u8; 256] = table::<5>();
/// 1 for a model that keeps light out but is lit itself (slabs, stairs).
pub static LIT_INSIDE: [u8; 256] = table::<6>();

pub const SHAPE_AIR: u8 = 0;
pub const SHAPE_CUBE: u8 = 1;
pub const SHAPE_CROSS: u8 = 2;
pub const SHAPE_LIQUID: u8 = 3;
pub const SHAPE_MODEL: u8 = 4;

#[inline(always)]
pub fn block(id: u8) -> &'static Block {
    let i = id as usize;
    if i < BLOCK_COUNT {
        &BLOCKS[i]
    } else {
        &BLOCKS[STONE as usize]
    }
}

/// JSON description of the registry for the UI (names, states, textures, shapes, flags).
pub fn registry_json() -> String {
    use crate::shapes::{shapes, FULL_SIDE, NO_TEX};
    let shapes = shapes();
    let mut s = String::with_capacity(65536);
    s.push_str("{\"blocks\":[");
    for (i, b) in BLOCKS.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        let shape = match b.shape {
            Shape::Air => "air",
            Shape::Cube => "cube",
            Shape::Cross => "cross",
            Shape::Liquid => "liquid",
            Shape::Model => "model",
        };
        let kind = match b.model {
            ModelKind::None => "",
            ModelKind::Torch => "torch",
            ModelKind::WallTorch(_) => "wall_torch",
            ModelKind::Slab(_) => "slab",
            ModelKind::Stairs(..) => "stairs",
            ModelKind::Bed(..) => "bed",
        };
        // Small attachments (plants, torches) break at a touch and show as flat items.
        let small = matches!(b.shape, Shape::Cross) || matches!(b.model, ModelKind::Torch | ModelKind::WallTorch(_));
        // Sides solid enough to hang a torch on or stand one on (bit per face, +X -X +Y -Y +Z -Z).
        let sturdy = match &shapes.models[i] {
            _ if !b.solid => 0,
            Some(m) => (0..6).fold(0u8, |a, f| a | (((m.cover[f] == FULL_SIDE) as u8) << f)),
            None if b.shape == Shape::Cube => 63,
            None => 0,
        };
        s.push_str(&format!(
            "{{\"id\":{},\"name\":\"{}\",\"label\":\"{}\",\"state\":\"{}\",\"shape\":\"{}\",\"model\":\"{}\",\"layer\":{},\"tex\":[{},{},{},{},{},{}],\"uvt\":[{},{},{},{},{},{}],\"tint\":{},\"emit\":{},\"solid\":{},\"replaceable\":{},\"placeable\":{},\"small\":{},\"double\":{},\"sturdy\":{}",
            i, b.name, b.label, b.state, shape, kind, b.layer as u8, b.tex[0], b.tex[1], b.tex[2], b.tex[3], b.tex[4], b.tex[5],
            b.uvt[0], b.uvt[1], b.uvt[2], b.uvt[3], b.uvt[4], b.uvt[5], b.tint, b.emit, b.solid, b.replaceable, b.placeable, small, b.double, sturdy
        ));
        if let Some(m) = &shapes.models[i] {
            s.push_str(",\"boxes\":[");
            for (k, bx) in m.bounds.iter().enumerate() {
                if k > 0 {
                    s.push(',');
                }
                s.push_str(&format!("[{},{},{},{},{},{}]", bx[0], bx[1], bx[2], bx[3], bx[4], bx[5]));
            }
            s.push_str("],\"parts\":[");
            for (k, p) in m.parts.iter().enumerate() {
                if k > 0 {
                    s.push(',');
                }
                let t = |f: usize| if p.faces[f].tex == NO_TEX { -1 } else { p.faces[f].tex as i32 };
                s.push_str(&format!(
                    "[{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}]",
                    p.from[0], p.from[1], p.from[2], p.to[0], p.to[1], p.to[2],
                    t(0), t(1), t(2), t(3), t(4), t(5),
                    p.faces[0].uvt, p.faces[1].uvt, p.faces[2].uvt, p.faces[3].uvt, p.faces[4].uvt, p.faces[5].uvt
                ));
            }
            s.push(']');
        }
        s.push('}');
    }
    s.push_str("],\"textures\":[");
    for (i, n) in tex::NAMES.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push('"');
        s.push_str(n);
        s.push('"');
    }
    s.push_str("]}");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_match_table() {
        assert_eq!(BLOCKS[GRASS as usize].name, "grass_block");
        assert_eq!(BLOCKS[WATER_B as usize].name, "water");
        assert_eq!(BLOCKS[TORCH_B as usize].name, "torch");
        assert_eq!(BLOCKS[RED_MUSHROOM_B as usize].name, "red_mushroom");
        assert_eq!(BLOCKS[SNOWY_GRASS as usize].name, "snowy_grass");
        assert_eq!(OPAQUE[STONE as usize], 1);
        assert_eq!(OPAQUE[OAK_LEAVES_B as usize], 0);
        assert_eq!(EMIT[GLOWSTONE_B as usize], 15);
        assert_eq!(tex::NAMES[tex::RED_MUSHROOM as usize], "red_mushroom");
        assert_eq!(BLOCKS[IRON_BLOCK_B as usize].name, "iron_block");
        assert_eq!(tex::NAMES[tex::IRON_BLOCK as usize], "iron_block");
        assert_eq!(BLOCKS[YELLOW_BED_B as usize].name, "yellow_bed");
        assert_eq!(tex::NAMES[tex::WALL_TORCH as usize], "wall_torch");
        assert_eq!(tex::NAMES[tex::YELLOW_BED_FOOT_END as usize], "yellow_bed_foot_end");
    }

    #[test]
    fn variants_fill_their_ranges() {
        // Every id below BLOCK_COUNT is a real block, and each (family, state) pair appears once.
        let mut seen = std::collections::HashSet::new();
        for b in BLOCKS.iter() {
            assert!(seen.insert((b.name, b.state)), "duplicate {}[{}]", b.name, b.state);
        }
        assert_eq!(BLOCKS[(WALL_TORCH_B + 3) as usize].state, "facing=west");
        assert_eq!(BLOCKS[bed_id(3, 3, true) as usize].name, "yellow_bed");
        assert_eq!(BLOCKS[bed_id(3, 3, true) as usize].state, "facing=west,part=head");
        assert_eq!(bed_id(3, 3, true) as usize, SLAB_B as usize - 1);
        assert_eq!(BLOCKS[slab_id(7, true) as usize].name, "sandstone_slab");
        assert_eq!(slab_id(7, true) as usize, STAIRS_B as usize - 1);
        assert_eq!(BLOCKS[stairs_id(5, 3, true) as usize].state, "facing=west,half=top");
        assert_eq!(stairs_id(5, 3, true) as usize, LOG_AXIS_B as usize - 1);
        assert_eq!(BLOCKS[log_id(2, 1) as usize].name, "spruce_log");
        assert_eq!(log_id(2, 1) as usize, BLOCK_COUNT - 1);
        // One placeable variant per family.
        let mut families = std::collections::HashMap::new();
        for b in BLOCKS.iter().filter(|b| b.placeable) {
            assert!(families.insert(b.name, ()).is_none(), "{} placeable twice", b.name);
        }
        assert_eq!(LIT_INSIDE[slab_id(0, false) as usize], 1);
        assert_eq!(LIT_INSIDE[TORCH_B as usize], 0);
    }
}
