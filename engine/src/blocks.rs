//! Block registry: ids, render / physics / light properties and texture layers.
//!
//! Face order used everywhere in the engine: 0 = +X, 1 = -X, 2 = +Y, 3 = -Y, 4 = +Z, 5 = -Z.

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
    pub const RED_BED_TOP: u16 = 73;
    pub const RED_BED_SIDE: u16 = 74;
    pub const BLUE_BED_TOP: u16 = 75;
    pub const BLUE_BED_SIDE: u16 = 76;
    pub const GREEN_BED_TOP: u16 = 77;
    pub const GREEN_BED_SIDE: u16 = 78;
    pub const YELLOW_BED_TOP: u16 = 79;
    pub const YELLOW_BED_SIDE: u16 = 80;

    pub const COUNT: usize = 81;

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
        "end_stone", "red_bed_top", "red_bed_side", "blue_bed_top", "blue_bed_side", "green_bed_top", "green_bed_side",
        "yellow_bed_top", "yellow_bed_side",
    ];
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Shape {
    Air,
    /// Full cube.
    Cube,
    /// Two diagonal quads (plants, torch).
    Cross,
    /// Full cube with a lowered surface when exposed (water, lava).
    Liquid,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Layer {
    Opaque = 0,
    Cutout = 1,
    Translucent = 2,
}

#[derive(Clone, Copy)]
pub struct Block {
    pub name: &'static str,
    pub label: &'static str,
    pub shape: Shape,
    pub layer: Layer,
    /// Texture layer per face: +X -X +Y -Y +Z -Z.
    pub tex: [u16; 6],
    /// Full opaque cube: hides neighbour faces, casts ambient occlusion, blocks all light.
    pub opaque: bool,
    /// Collides with entities.
    pub solid: bool,
    /// Light attenuation when light passes through (0..=15). Opaque blocks use 15.
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
    /// Shown in the creative inventory.
    pub placeable: bool,
}

const fn base(name: &'static str, label: &'static str, t: [u16; 6]) -> Block {
    Block {
        name,
        label,
        shape: Shape::Cube,
        layer: Layer::Opaque,
        tex: t,
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
pub const RED_BED_B: u8 = 66;
pub const BLUE_BED_B: u8 = 67;
pub const GREEN_BED_B: u8 = 68;
pub const YELLOW_BED_B: u8 = 69;

pub const BLOCK_COUNT: usize = 70;

pub static BLOCKS: [Block; BLOCK_COUNT] = [
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
    cube3("oak_log", "Oak Log", T::OAK_LOG_TOP, T::OAK_LOG, T::OAK_LOG_TOP),
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
    cube3("birch_log", "Birch Log", T::BIRCH_LOG_TOP, T::BIRCH_LOG, T::BIRCH_LOG_TOP),
    leaves("birch_leaves", "Birch Leaves", T::BIRCH_LEAVES, false),
    cube3("spruce_log", "Spruce Log", T::SPRUCE_LOG_TOP, T::SPRUCE_LOG, T::SPRUCE_LOG_TOP),
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
    Block { emit: 14, replaceable: false, ..plant("torch", "Torch", T::TORCH, false, 0) },
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
    cube3("red_bed", "Red Bed", T::RED_BED_TOP, T::RED_BED_SIDE, T::OAK_PLANKS),
    cube3("blue_bed", "Blue Bed", T::BLUE_BED_TOP, T::BLUE_BED_SIDE, T::OAK_PLANKS),
    cube3("green_bed", "Green Bed", T::GREEN_BED_TOP, T::GREEN_BED_SIDE, T::OAK_PLANKS),
    cube3("yellow_bed", "Yellow Bed", T::YELLOW_BED_TOP, T::YELLOW_BED_SIDE, T::OAK_PLANKS),
];

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
            },
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
/// Shape id: 0 air, 1 cube, 2 cross, 3 liquid.
pub static SHAPE: [u8; 256] = table::<5>();

pub const SHAPE_AIR: u8 = 0;
pub const SHAPE_CUBE: u8 = 1;
pub const SHAPE_CROSS: u8 = 2;
pub const SHAPE_LIQUID: u8 = 3;

#[inline(always)]
pub fn block(id: u8) -> &'static Block {
    let i = id as usize;
    if i < BLOCK_COUNT {
        &BLOCKS[i]
    } else {
        &BLOCKS[STONE as usize]
    }
}

/// JSON description of the registry for the UI (names, textures, flags).
pub fn registry_json() -> String {
    let mut s = String::with_capacity(8192);
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
        };
        s.push_str(&format!(
            "{{\"id\":{},\"name\":\"{}\",\"label\":\"{}\",\"shape\":\"{}\",\"layer\":{},\"tex\":[{},{},{},{},{},{}],\"tint\":{},\"emit\":{},\"solid\":{},\"replaceable\":{},\"placeable\":{}}}",
            i, b.name, b.label, shape, b.layer as u8, b.tex[0], b.tex[1], b.tex[2], b.tex[3], b.tex[4], b.tex[5],
            b.tint, b.emit, b.solid, b.replaceable, b.placeable
        ));
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
        assert_eq!(tex::NAMES[tex::YELLOW_BED_SIDE as usize], "yellow_bed_side");
    }
}
