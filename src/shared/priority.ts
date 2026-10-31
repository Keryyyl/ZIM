/** Grupa ważności: każda wiadomość ma najwyżej jeden z tych tagów. Kolejność = kolejność w Odebranych. */
export const KEEP_TAG = 'Zachować'
export const PRIORITY_TAGS = ['Pilne', 'Luźne', KEEP_TAG]

export const isPriorityName = (name: string): boolean => PRIORITY_TAGS.some((n) => n.toLowerCase() === name.toLowerCase())
