import { ALLY, FRIEND } from '../rules/citystates';
import { LIBERATE_INFLUENCE } from '../rules/liberation';
import { PLEDGE_BROKEN, PLEDGE_REST, PLEDGE_TURNS } from '../rules/pledges';
import { MAX_RISES } from '../rules/climate';
import { SEASON_TURNS } from '../rules/disasters';
import { ARMY_BONUS, CORPS_BONUS } from '../rules/armies';

/**
 * The Civilopedia's own words: the game's core ideas (how cities grow, what happiness does, how a
 * fight goes...), each way to win, the kinds of city-state, and what each unit ability and each
 * named special effect of a building or wonder means. Everything else the Civilopedia says comes from
 * the rules' data (`pedia.ts`). `[[key|text]]` in a text is a link to another article.
 */

export interface Article {
  id: string;
  name: string;
  glyph: string;
  color: string;
  /** A line under the title. */
  sub: string;
  sections: { title?: string; text: string }[];
}

export const CONCEPTS: Article[] = [
  {
    id: 'basics',
    name: 'How to play',
    glyph: 'globe',
    color: '#2f6fc0',
    sub: 'An empire, a turn at a time',
    sections: [
      { text: 'You lead a civilization from its first city to the space age. Each turn you move your units, choose what your cities build and what your scholars study, and then end the turn. Everyone takes their turn at the same time; the turn ends when every player is done (or the turn timer runs out).' },
      { title: 'People at war', text: 'Players at war with each other take their turns one side at a time, so a war is never a race of clicks. One side moves while the other waits: its cities, research and diplomacy are still its own, but not its units. A war declared during a turn lets the side that declared it finish first. The side that goes first changes every turn. With a turn timer, each side gets the whole clock, and a player who leaves the game hands the turn on. Teammates take their turn together, and everyone else, including the bots, plays at once as usual. The host can turn this off in the lobby (At war: All at once).' },
      { title: 'The first turns', text: 'Found your capital with your [[unit:settler|Settler]] at once: rivers, the coast and grassland make the best start. Explore with your [[unit:warrior|Warrior]] or a [[unit:scout|Scout]], pick a first [[concept:research|technology]], and build a few more units. More cities, placed well, are how an empire grows: build [[unit:settler|Settlers]] while there is good land free.' },
      { title: 'What to watch', text: 'The top bar shows your empire: science, gold (and its change each turn), [[concept:happiness|happiness]], progress toward a [[concept:golden|golden age]], culture toward the next [[concept:policies|social policy]], and faith. The panel at the top right lists what needs deciding before the turn can end.' },
      { title: 'Winning', text: 'There are five ways to win: [[victory:domination|Domination]], [[victory:science|Science]], [[victory:culture|Culture]], [[victory:diplomatic|Diplomacy]], and the [[victory:score|Score]] when the last turn comes. The Victory panel shows how near everyone is.' },
      { title: 'Help as you play', text: 'Hover anything with a picture for a short card about it; right-click it to read its article here. Press ? for every keyboard shortcut.' },
    ],
  },
  {
    id: 'cities',
    name: 'Cities and growth',
    glyph: 'city',
    color: '#8a6a3a',
    sub: 'Citizens, tiles, food, production',
    sections: [
      { text: 'Each citizen of a city works a tile of its land (or works as a specialist in one of its buildings). Tiles yield food, production, gold, science, culture or faith, more with [[concept:improvements|improvements]] and resources. The city works its best tiles by itself; its focus says what it favours.' },
      { title: 'Growth', text: 'Every citizen eats two food. What is left over fills the city’s food box, and when it is full the city grows by a citizen. Each new citizen needs more food than the last. An unhappy empire grows slowly, and not at all when very unhappy.' },
      { title: 'Production', text: 'Production builds units, buildings, wonders and projects, one at a time; shift-click adds to a queue. Gold buys things outright (not world wonders), and faith buys religious units and buildings.' },
      { title: 'Borders', text: 'Culture grows a city’s land a tile at a time. Gold buys a tile at once. A city works tiles up to three away.' },
      { title: 'Defence', text: 'A city has strength and hit points of its own, more with walls and castles, and fires at an enemy within two tiles once a turn. It heals 20 hit points a turn, only 8 after a turn it was attacked, and none while every tile round it holds an enemy. A city brought to no hit points is taken by the first melee unit to enter it. A city taken can be annexed, kept as a puppet, or razed; one taken from someone who hadn’t founded it can be [[concept:diplomacy|liberated]], back to its founder.' },
    ],
  },
  {
    id: 'improvements',
    name: 'Tiles and improvements',
    glyph: 'pick',
    color: '#6a6a6a',
    sub: 'What the land yields',
    sections: [
      { text: 'Every tile yields something by its [[cat:terrain|terrain]] and feature: grassland food, hills production, the coast food and gold. Rivers add gold and fresh water. [[cat:resource|Resources]] add more, once improved.' },
      { title: 'Workers', text: '[[unit:worker|Workers]] build [[cat:improvement|improvements]]: farms for food, mines for production, trading posts for gold, and the right improvement on each resource (pastures, camps, plantations, quarries, fishing boats from a Work Boat). They also build roads, which connect cities and speed units.' },
      { title: 'Resources', text: 'Bonus resources yield more food or production. Luxury resources make your empire [[concept:happiness|happy]], each kind once. Strategic resources (horses, iron, coal, oil, aluminum, uranium) are needed by the units and buildings that use them; each improved deposit supplies a few.' },
      { title: 'Fallout', text: 'A nuclear blast leaves [[terrain:fallout|fallout]] on much of the land it strikes. A tile under fallout yields next to nothing, hurts units that end their turn on it, and can’t be improved or repaired until a worker scrubs it away (Scrub Fallout).' },
    ],
  },
  {
    id: 'gold',
    name: 'Gold',
    glyph: 'gold',
    color: '#a8862a',
    sub: 'The treasury',
    sections: [
      { text: 'Gold comes from tiles (rivers, the coast, gold and silver, trading posts), from markets, banks and their like, from trade routes, and from clearing barbarian camps and ancient ruins.' },
      { title: 'Upkeep', text: 'Each turn buildings, units and roads cost their upkeep; the top bar shows what is left over. If the treasury runs dry while you are losing gold, your units start to be disbanded.' },
      { title: 'Spending it', text: 'Gold buys units and buildings outright in a city (not world wonders), buys tiles for a city, upgrades units, and wins influence with city-states as gifts.' },
    ],
  },
  {
    id: 'happiness',
    name: 'Happiness',
    glyph: 'happy',
    color: '#5a8a2a',
    sub: 'The brake on growing wide',
    sections: [
      { text: 'Your empire’s happiness is shown in the top bar. Every city makes some unhappiness, and so does every citizen; luxury resources (each kind counts once), some buildings, wonders, policies and beliefs make people happy.' },
      { title: 'Unhappy', text: 'Below zero, cities grow far more slowly; at -10 or worse they stop growing altogether. Settle new cities with an eye on the luxuries you can connect, and build temples, amphitheaters, colosseums and the like as you grow.' },
      { title: 'Happy', text: 'Happiness above zero adds up, turn by turn, toward a [[concept:golden|golden age]].' },
    ],
  },
  {
    id: 'golden',
    name: 'Golden ages',
    glyph: 'golden',
    color: '#b8892a',
    sub: 'A burst of plenty',
    sections: [
      { text: 'Each turn your spare happiness is added toward a golden age; when there is enough, one begins. Each golden age needs more than the last.' },
      { text: 'During a golden age, tiles that already make production make one more, tiles that make gold make one more, and culture comes 20% faster. A [[unit:great_artist|Great Artist]] can start one at once, and some wonders and policies start or lengthen them.' },
    ],
  },
  {
    id: 'great',
    name: 'Great people',
    glyph: 'xp',
    color: '#b8892a',
    sub: 'The few who change everything',
    sections: [
      { text: 'Specialists, some buildings and wonders earn great person points of their kind each turn. When enough are earned, a great person is born in your capital. Each one born makes the next of that kind cost more.' },
      { title: 'What they do', text: '[[unit:great_scientist|Great Scientists]] discover science or build an Academy; [[unit:great_engineer|Great Engineers]] hurry production (wonders too) or build a Manufactory; [[unit:great_merchant|Great Merchants]] bring gold from a trade mission or build a Customs House; [[unit:great_artist|Artists]], [[unit:great_writer|Writers]] and [[unit:great_musician|Musicians]] create great works for [[concept:tourism|tourism]]; [[unit:great_prophet|Great Prophets]] found and spread a [[concept:religion|religion]]; [[unit:great_general|Great Generals]] strengthen units near them.' },
      { title: 'Their improvements', text: 'A great person’s improvement (an Academy, a Manufactory...) yields a great deal for good, on the tile where it stands.' },
      { title: 'Bought with faith', text: 'From the Industrial Era, faith buys great people in your cities, of the kinds a finished policy tree allows: Great Engineers with Tradition or Liberty, Generals with Honor, Artists, Writers and Musicians with Aesthetics, Merchants with Commerce, Admirals with Exploration, Scientists with Rationalism; every kind with the To the Glory of God belief. (Great Prophets any time, with Piety.) The first costs 1000 faith at standard speed (670 at quick), and each one after half as much again.' },
    ],
  },
  {
    id: 'combat',
    name: 'Combat',
    glyph: 'war',
    color: '#b8432f',
    sub: 'Strength against strength',
    sections: [
      { text: 'Each military unit has a strength; ranged units also have a ranged strength and a range. When two meet, the stronger side does more damage and takes less. Melee units trade blows; ranged units fire without being hit back. Units have 100 hit points, and a wounded unit fights worse.' },
      { title: 'Terrain and position', text: 'Defending on hills, in forest or jungle is stronger; marsh and open flood plains are weaker. Fortifying (F) adds to defence each turn up to +50%. Each of your other units next to the target adds 10% to an attack (flanking). A [[unit:great_general|Great General]] adds 15% to units within two tiles.' },
      { title: 'Zones of control', text: 'Stepping from one tile next to an enemy unit or city to another next to it ends a unit’s move. Crossing a river without a bridge ([[tech:construction|Construction]]) or embarking takes all its moves.' },
      { title: 'Experience', text: 'Fighting earns experience, and at each step a unit takes a [[cat:promotion|promotion]]. Barracks and the like start new units with experience.' },
      { title: 'Line of sight', text: 'A ranged unit fires at what it can see. Next door it always can; further off, forest, jungle, hills and mountains block its view of what lies behind them (not the tile itself), though a line running past the edge of one can look round it from two tiles away. From a hill a unit sees over forest and other hills, but not over wooded hills or mountains. With Indirect Fire (Artillery, Rocket Artillery and the Battleship have it, and archers, siege units and ships can earn it) a unit fires over all of it, at anything your units see.' },
      { title: 'Cities', text: 'Siege units hit cities twice as hard; mounted and armoured units are weaker against them. A city fires once a turn at a unit within two tiles.' },
      { title: 'Corps and armies', text: 'From the Industrial Era, units of a kind side by side can join as one, far stronger: see [[concept:formations|Corps and armies]].' },
    ],
  },
  {
    id: 'formations',
    name: 'Corps and armies',
    glyph: 'strength',
    color: '#8a5a2a',
    sub: 'Units of a kind, joined as one',
    sections: [
      { text: `With [[tech:military_science|Military Science]], two units of the same kind side by side can join as a corps (a fleet, at sea): select one, and Form a corps takes the other into it. With [[tech:replaceable_parts|Replaceable Parts]], a corps and a third unit of its kind join as an army (an armada). A corps fights with ${CORPS_BONUS}% more strength and an army with ${ARMY_BONUS}% more, in attack and defence, as one unit on one tile; its flag is marked II or III. The bonus multiplies everything else (hills, fortifying, promotions), so it counts in full wherever it fights.` },
      { title: 'What it costs', text: 'A corps’s gold upkeep is half again a unit’s, and an army’s twice a unit’s. It still holds every one of its units’ strategic resources, and its upgrade costs one for each of them. Joining spends the unit’s turn. The joined unit has the hit points of both shared out, and the experience and promotions of the more experienced. A formation never splits again; one that can’t be paid for loses a unit at a time. Aircraft, missiles, carriers and civilians don’t form corps.' },
    ],
  },
  {
    id: 'movement',
    name: 'Moving',
    glyph: 'moves',
    color: '#3f8f4f',
    sub: 'Moves, roads, the sea',
    sections: [
      { text: 'Each unit has moves to spend each turn. Open land costs one; hills, forest, jungle and marsh cost two; mountains and ice cannot be entered. Roads cost a third of a move between road tiles, railroads less still.' },
      { text: 'A unit ordered far away walks there over the turns that follow. One military unit and one civilian unit can share a tile.' },
      { title: 'The sea', text: 'With [[tech:optics|Optics]], land units embark onto the coast (embarking takes all their moves, and embarked units are weak). [[tech:astronomy|Astronomy]] lets them cross the ocean.' },
    ],
  },
  {
    id: 'research',
    name: 'Research',
    glyph: 'science',
    color: '#2f6fc0',
    sub: 'The technology tree',
    sections: [
      { text: 'Science goes toward one technology at a time. Each needs the ones before it; click any later one in the tree and the way there is queued. Technologies unlock units, buildings, wonders and improvements, and the eras follow from them.' },
      { text: 'Each city you have makes technologies cost a little more, so a wide empire needs more science. Libraries, universities and scientists are the way to it; [[unit:great_scientist|Great Scientists]] jump ahead.' },
      { title: 'Eurekas', text: 'Nearly every technology has a deed that brings it a third of the way: build a Mine and The Wheel is a third researched, kill a unit and Archery is, found a religion and Theology is. The lightning bolt on each technology in the tree says its deed (point at it), and lights up once you have done it. A deed counts whenever it is done, even long before you can research the technology (its third waits for you there), and on a team, once for all of you.' },
      { title: 'On a team', text: 'Each of you chooses your own research, and the progress is the team’s: research the same technology and both your science goes into it; research different ones and the team works on both at once. A technology any of you learns, all of you know. The tree shows what each teammate is researching. Technologies cost a team more: half again for each civilization past the first.' },
    ],
  },
  {
    id: 'policies',
    name: 'Social policies',
    glyph: 'crown',
    color: '#b8892a',
    sub: 'How your people are governed',
    sections: [
      { text: 'Culture builds toward social policies; each costs more than the last, and more for each city you have. Policies come in trees: adopt a tree’s first policy to open it, then its others in any order their links allow; adopting all of them completes the tree for a final bonus.' },
      { text: 'Trees open as the eras come. [[policy:tradition|Tradition]] suits a few great cities, [[policy:liberty|Liberty]] many small ones, [[policy:honor|Honor]] war. Piety and Rationalism can’t both be open. From the Industrial Era, an ideology: Freedom, Order or Autocracy, each with tenets in three levels.' },
    ],
  },
  {
    id: 'religion',
    name: 'Religion',
    glyph: 'faith',
    color: '#7a6a9a',
    sub: 'Faith, pantheons and prophets',
    sections: [
      { text: 'Shrines, temples, some wonders and tiles make faith. With enough faith, found a pantheon: a single belief for your people. More faith (once you have a pantheon) brings a [[unit:great_prophet|Great Prophet]], who founds a religion in one of your cities with a founder belief (for you) and a follower belief (for every city that follows it); a second prophet enhances it. The world has room for half as many religions as civs, and one: a prophet born keeps its place, but faith that comes late may find none left.' },
      { title: 'Spreading', text: 'Cities of a religion press it on cities near them. Faith buys [[unit:missionary|Missionaries]] to convert cities outright and [[unit:inquisitor|Inquisitors]] to drive other religions out. Each belief can be taken by only one religion.' },
    ],
  },
  {
    id: 'trade',
    name: 'Trade routes',
    glyph: 'trade',
    color: '#8a6a3a',
    sub: 'Caravans and cargo ships',
    sections: [
      { text: 'A [[unit:caravan|Caravan]] (over land) or a [[unit:cargo_ship|Cargo Ship]] (by sea) in one of your cities opens a trade route to a city in reach: gold for both ends, science from more advanced civilizations, food and production between your own cities. Routes last a number of turns, then the unit can be sent again.' },
      { text: 'How many routes you can run grows with technology and some wonders. Routes to other civilizations also carry religion and tourism.' },
    ],
  },
  {
    id: 'espionage',
    name: 'Espionage',
    glyph: 'spy',
    color: '#3a4a5a',
    sub: 'Spies from the Renaissance',
    sections: [
      { text: 'From the Renaissance, a spy joins you each era. Send one to another civilization’s city to steal a technology they know and you don’t (it takes about as long as their city would take to research it), or keep it in one of your own cities to catch spies there.' },
    ],
  },
  {
    id: 'tourism',
    name: 'Culture and tourism',
    glyph: 'tourism',
    color: '#7a4aa8',
    sub: 'Influence over the world',
    sections: [
      { text: 'Culture builds toward social policies and grows your borders. Tourism, from wonders, great works and some buildings, carries your culture abroad: over the game it builds your influence over each other civilization. Influential over every one of them (from the Industrial Era), you win a [[victory:culture|cultural victory]].' },
      { text: 'Great works are made by [[unit:great_artist|Great Artists]], [[unit:great_writer|Writers]] and [[unit:great_musician|Musicians]]: each brings 2 tourism (3 more for a building of two slots or more with them all full), and needs an empty slot in a building of its kind (amphitheaters, opera houses, museums, some wonders).' },
    ],
  },
  {
    id: 'diplomacy',
    name: 'Diplomacy',
    glyph: 'peace',
    color: '#3f8f6f',
    sub: 'War, peace and city-states',
    sections: [
      { text: 'You meet a civilization when you first see its units or land. From the Diplomacy panel you can declare war, make peace (a peace treaty holds for a number of turns), and open your borders to its units.' },
      { title: 'Borders', text: 'In peace, no unit of yours, soldier or civilian, may enter another civilization’s land unless it has opened its borders to you: open borders come by a deal at the trade table (with Writing). Missionaries, inquisitors and Great Prophets go in regardless, and a city-state’s land is open to everyone. When open borders end, your units still in their land are moved out.' },
      { title: 'City-states', text: `City-states are small single-city nations, marked “City-state” over their banners on the map, with your influence on a bar beneath (a “!” while one asks something of you). Click a city-state’s city to speak to it. Gifts of gold and services (clearing barbarian camps near them) win influence with them, which drifts back each turn. At ${FRIEND} influence they are your friends; the friend with the most, at ${ALLY} or more, is their ally. Friends and allies get what their [[cat:citystate|kind]] gives; an ally also gets their luxuries and their vote in the United Nations.` },
      { title: 'Pledges to protect', text: `From a city-state’s card you may pledge to protect it (met, at peace, your influence not below 0). Your influence with it then rests ${PLEDGE_REST} higher, and anyone else who bullies it for tribute or declares war on it offends you, and the leaders who have pledged remember it. Bully or attack it yourself and the pledge is broken (${PLEDGE_BROKEN} influence lost); let your influence fall below 0 and it lapses. Either way you can’t pledge to it again for ${PLEDGE_TURNS} turns (at standard speed).` },
      { title: 'Liberating cities', text: `A city you take from a civilization that hadn’t founded it (it had been taken from its founder before) can be liberated instead of annexed, kept as a puppet or razed: it goes back to its founder, who never forgets it. A city-state given back its city gives you ${LIBERATE_INFLUENCE} influence with it, enough to be its ally. A civilization or city-state that had been destroyed comes back to life with the city, at peace with you, its quarrels with the world forgotten. Liberating cities also weighs against your conquests in other leaders’ eyes. An original capital given back counts again as its founder’s for [[victory:domination|Domination]].` },
      { title: 'Vassals', text: 'A civilization losing a war can capitulate instead of fighting to the end: offer it (or demand it of a beaten enemy) at the trade table, where it ends the war. A vassal keeps its cities, but its master makes its wars and its peace (it is at war with whoever its master is, and at peace with the rest), it pays its master a quarter of its gold income each turn, and their borders are open to each other. Its cities count as its master’s toward [[victory:domination|Domination]]. Once it has served ten turns and has half its master’s people, a vassal may declare its independence; a master may set its vassal free; and a vassal whose master falls goes free. Beaten leaders kneel, and winning ones demand it.' },
    ],
  },
  {
    id: 'barbarians',
    name: 'Barbarians and ruins',
    glyph: 'skull',
    color: '#5a3a3a',
    sub: 'Danger and reward in the wilds',
    sections: [
      { text: 'Barbarians come out of camps in the unclaimed lands and raid whoever is near. Clearing a camp brings gold, and city-states close by are grateful for it.' },
      { title: 'Captured workers', text: 'A worker (or a settler, which becomes a worker) that barbarians catch is theirs, and is led back to their camp to wait there. Step a soldier onto it on the way, or clear the camp, to take it back.' },
      { title: 'Clans', text: 'Every camp is a clan’s, and a civilization that has found a camp can deal with its clan in the Diplomacy screen (or by clicking the camp): bribe it, and its raiders leave you and your team alone for a while; hire one of its warriors, now and then; or pay it to raid a civilization you have met, which will hear of it, and may find out who paid. Left alone, a clan grows, faster when paid and as its raiders pillage, and slower as they die. Grown, it settles down where its camp is as a new city-state, if the camp is in no one’s land and no city is close by.' },
      { text: 'Ancient ruins are scattered over the world. The first land unit to step on one gets its reward: gold, a technology, a citizen, a map of the land round it, or a unit.' },
    ],
  },
  {
    id: 'world',
    name: 'A living world',
    glyph: 'globe',
    color: '#4a7a5a',
    sub: 'Seasons, disasters and the rising sea',
    sections: [
      { text: `The year turns through spring, summer, autumn and winter, ${SEASON_TURNS} turns a season at standard speed (fewer at quick). In autumn the woods turn red and gold; in winter snow lies on the hills, the mountains and the tundra, away from the tropics. Rivers flood mostly in spring and never in winter; storms rise most in summer and autumn.` },
      { title: 'Volcanoes', text: 'A few mountains are live volcanoes, smoking at their peaks. Now and then one erupts: units beside it are hurt (some killed), cities beside it lose a citizen, and the improvements round it are buried in ash. But the ash leaves the land round it rich for good: more food, and often production.' },
      { title: 'River floods', text: 'A river now and then bursts its banks, along its flat land (flood plains most of all). The farms and mines there may be washed away, to be repaired by a [[unit:worker|Worker]]; the silt it leaves is food there for good.' },
      { title: 'Storms', text: 'Storms rise over the open sea and blow across it for a few turns. Ships and embarked units in their way are battered, though never sunk, and improvements on the coast and at sea may be wrecked. Keep your fleets in port when one comes.' },
      { title: 'The rising sea', text: `The Coal and Oil the world burns (each Factory, each ironclad, tank, warship and aircraft that needs them, every turn) warms it. Each time the world’s carbon passes a threshold the sea rises, up to ${MAX_RISES} times: the lowest of the coast (flat land by the sea, flood plains and marsh first) floods, its improvements ruined, and the next rise takes what it flooded under the sea for good. A city’s own tile always holds out. Units on drowned land move to the nearest dry ground.` },
      { title: 'Quieter news', text: 'The host can turn disasters off in the lobby. News of them can be quietened in the settings, as other news of the world can.' },
    ],
  },
];

export const VICTORIES: Article[] = [
  {
    id: 'domination',
    name: 'Domination',
    glyph: 'war',
    color: '#b8432f',
    sub: 'Hold every original capital',
    sections: [
      { text: 'Capture the original capital of every other civilization and hold them all, your own too (your vassals’ hold theirs for you). A civilization with no cities left (and no settler to found one) is out of the game, unless someone [[concept:diplomacy|liberates]] a city of its: then it lives again, and an original capital given back is its founder’s again, to be taken once more.' },
    ],
  },
  {
    id: 'science',
    name: 'Science',
    glyph: 'rocket',
    color: '#3a5a9a',
    sub: 'Reach the stars',
    sections: [
      { text: 'Build the [[wonder:apollo_program|Apollo Program]], then the spaceship’s parts (three boosters, a cockpit, an engine and a stasis chamber), each unlocked by a late technology. The first civilization to finish its spaceship wins.' },
    ],
  },
  {
    id: 'culture',
    name: 'Culture',
    glyph: 'tourism',
    color: '#7a4aa8',
    sub: 'Be influential over every civilization',
    sections: [
      { text: 'Your tourism builds influence over each other civilization. Be influential over every civilization still standing, once you’re in the Industrial Era, and you win. Wonders, great works, hotels and some policies bring tourism; see [[concept:tourism|Culture and tourism]].' },
    ],
  },
  {
    id: 'diplomatic',
    name: 'Diplomacy',
    glyph: 'vote',
    color: '#3f8f6f',
    sub: 'Be elected World Leader',
    sections: [
      { text: 'Once someone builds the [[wonder:united_nations|United Nations]], the world votes for a World Leader every ten turns. Each civilization has two delegates (the United Nations’ builder two more), and every city-state’s delegate votes with its ally. Win more than half of all the delegates the world began with (those of civilizations and city-states since fallen count too; more than two thirds in a game of teams), and you win. City-states are won with gifts of gold, or by a spy rigging their elections (from the Renaissance).' },
    ],
  },
  {
    id: 'score',
    name: 'Score',
    glyph: 'chart',
    color: '#5a6a7a',
    sub: 'Lead when time runs out',
    sections: [
      { text: 'If nobody has won by the game’s last turn, the civilization with the highest score wins. Score comes from cities, citizens, land, technologies, wonders, social policies and future technologies.' },
    ],
  },
];

export const CITY_STATE_KINDS: Article[] = [
  { id: 'maritime', name: 'Maritime', glyph: 'anchor', color: '#2a6a9a', sub: 'Food for your cities', sections: [{ text: 'Friends get extra food in every city; allies twice as much.' }] },
  { id: 'cultured', name: 'Cultured', glyph: 'culture', color: '#8a4aa8', sub: 'Culture', sections: [{ text: 'Friends get culture each turn, more as they advance; allies get twice as much.' }] },
  { id: 'militaristic', name: 'Militaristic', glyph: 'sword', color: '#a83a2a', sub: 'Gifts of units', sections: [{ text: 'Friends are sent a military unit now and then, the best they can field; allies more often.' }] },
  { id: 'mercantile', name: 'Mercantile', glyph: 'gold', color: '#b8892a', sub: 'Happiness', sections: [{ text: 'Friends get extra happiness; allies more.' }] },
  { id: 'religious', name: 'Religious', glyph: 'faith', color: '#7a6a9a', sub: 'Faith', sections: [{ text: 'Friends get faith each turn; allies twice as much.' }] },
];

/** What each unit ability means, in a line. */
export const ABILITY_TEXT: Record<string, string> = {
  found_city: 'Founds a city (and is used up).',
  build: 'Builds improvements and roads.',
  build_sea: 'Builds fishing boats and offshore platforms on sea resources.',
  ignore_terrain: 'Every tile costs it a single move.',
  no_terrain_defense: 'No defensive bonus from hills, forest or jungle (their penalties still count).',
  bonus_vs_mounted: '+50% strength against mounted units.',
  bonus_vs_armor: '+100% strength against armour.',
  bonus_vs_cities: '+200% strength against cities.',
  penalty_vs_cities: '-33% strength against cities.',
  must_setup: 'Must set up (a move) before it can fire.',
  indirect_fire: 'Indirect Fire: fires over hills, forest, jungle and mountains in the way, at anything your units see.',
  no_attack: 'Cannot attack.',
  coast_only: 'Cannot enter the open ocean.',
  see_submarines: 'Sees submarines.',
  intercept: 'Fires on enemy aircraft striking near it.',
  invisible: 'Unseen by most units until next to them.',
  extra_sight: '+1 sight.',
  heal_adjacent: 'Ships with it or next to it heal 15 more.',
  repair_fleet: 'Repair Fleet: spent, every ship of yours on its tile or next to it is healed fully.',
  concert_tour: 'Concert Tour: spent in another civ’s land, ten turns of your tourism toward them at once.',
  paradrop: 'Can parachute from your land to land you know up to 9 tiles away, if it hasn’t moved.',
  nuke: 'A nuclear weapon: destroys what is round where it lands and leaves fallout on much of the land. Every civ that knows you will long remember it, those it falls on most, and city-states think less of you. An Atomic Bomb (not a missile) may be shot down by a fighter on patrol or an anti-aircraft gun near its target.',
  spread_religion: 'Spreads its religion to a city.',
  remove_heresy: 'Drives other religions out of a city.',
  found_religion: 'Founds or enhances a religion.',
  archaeology: 'Digs up antiquity sites for great works.',
  trade_route: 'Opens a trade route from one of your cities.',
  great_work: 'Creates a great work.',
  golden_age: 'Can start a golden age.',
  tile_improvement: 'Builds its great improvement.',
  combat_bonus_aura: '+15% strength for your units of its kind within two tiles (land for generals, ships for admirals).',
  hurry: 'Hurries production in a city.',
  trade_mission: 'A trade mission: a large sum of gold.',
  discover_tech: 'Discovers science toward your research.',
  kill_heal: 'Heals 25 when it kills a unit.',
  jungle_fighter: '+33% strength fighting in forest and jungle.',
  homeland: '+25% strength while it stands in your own land.',
  foreign_lands: '+20% strength while it stands outside your own land.',
  haka: 'Enemy units next to it fight at -10% strength.',
  amphibious: 'No penalty for attacking from the sea or across a river.',
  political_treatise: 'Writes a political treatise: culture toward your next policy.',
  withdraw: 'May attack and still move.',
};

/** What the named special effects of buildings and wonders mean (a building's own note says the rest). */
export const SPECIAL_TEXT: Record<string, string> = {
  land_trade_range: 'Land trade routes from here reach further.',
  sea_trade_range: 'Sea trade routes from here reach further.',
  connects_by_sea: 'Connects the city to the capital by sea.',
  no_occupied_unhappiness: 'Ends the extra unhappiness of an occupied city.',
  airlift: 'Units can be airlifted between cities with airports.',
  slow_spies: 'Enemy spies steal more slowly here.',
  double_plunder: 'Twice the gold for plundering it, if it’s taken.',
  hanse_trade_production: '+5% production for each trade route from here to a city-state.',
  missionaries_extra_spread: 'Missionaries and prophets spread religion once more.',
  research_agreements_better: 'Research agreements give half again as much science.',
  upgrades_cheaper_33: 'Upgrading units costs a third less.',
  tech_steal_immune: 'Your technologies can’t be stolen.',
  extra_delegates: 'Two more votes for World Leader.',
  enables_nukes: 'Lets you build nuclear weapons.',
  enables_spaceship: 'Lets you build the spaceship’s parts.',
  extra_spy: 'An extra spy.',
};
