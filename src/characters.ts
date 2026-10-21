/** Trusted catalog shared by the browser and FBX conversion endpoint. */
export const CHARACTERS = [
  { id: 'chicken', name: 'Chicken Dance · Mixamo', url: '/character/Chicken%20Dance.fbx', file: 'amsterdam-hackathon/Geo/Chicken Dance.fbx' },
  { id: 'green-segments', name: 'Green Segments · Low poly', url: '/characters/green-segments.fbx', file: 'assets/characters/green-segments.fbx' },
] as const;
export type CharacterId = typeof CHARACTERS[number]['id'];
export const DEFAULT_CHARACTER: CharacterId = 'chicken';
export function characterDefinition(id: unknown) {
  const character = CHARACTERS.find(character => character.id === id);
  if (!character) throw new Error('Unknown character. Choose a character from the model selector.');
  return character;
}
export const characterOptions = () => CHARACTERS.map(character => `<option value="${character.id}">${character.name}</option>`).join('');
