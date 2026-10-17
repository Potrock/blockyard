/**
 * What the client's entry (`client.ts`) takes from the game's own shared files, by way of its client
 * code: the entry imports only the client API, its shared code and its client files.
 */
export { centre, period } from '../geometry';
export type { CityInfo, DealCheck, FightWire, LobbyView, MapWire, OrderResult, ReshapeWire, PreviewReply, ResearchAdvice, StatsInfo, View, WorkAdvice, FameEntry, DealHelp } from '../protocol';
