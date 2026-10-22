/** Trusted catalog shared by the browser and FBX conversion endpoint. */
export type CharacterDefinition = { id: string; name: string; url: string; file: string };
export const CHARACTERS: CharacterDefinition[] = [
  { id: 'chicken', name: 'Chicken Dance · Mixamo', url: '/character/Chicken%20Dance.fbx', file: 'amsterdam-hackathon/Geo/Chicken Dance.fbx' },
  { id: 'green-segments', name: 'Green Segments · Low poly', url: '/characters/green-segments.fbx', file: 'assets/characters/green-segments.fbx' },
];
export type CharacterId = string;
export function registerCharacter(character: CharacterDefinition) {
  const index = CHARACTERS.findIndex(entry => entry.id === character.id);
  if (index < 0) CHARACTERS.push(character); else CHARACTERS[index] = character;
  return character;
}
export const DEFAULT_CHARACTER: CharacterId = 'chicken';
export function characterDefinition(id: unknown) {
  const character = CHARACTERS.find(character => character.id === id);
  if (!character) throw new Error('Unknown character. Choose a character from the model selector.');
  return character;
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const characterOptions = () => CHARACTERS.map(character => `<option value="${escapeHtml(character.id)}">${escapeHtml(character.name)}</option>`).join('');
