// REGEX: value of a query parameter, up to the next "&", "#" or quote
const QUERY_VALUE = /([?&][^=&#"']*=)[^&#"']*/g;
// REGEX: "user:password@" right after the "://" of a URL
const USER_INFO = /(:\/\/)[^/@\s"']+@/g;

export function maskUrlSecrets(text: string): string {
  return text.replace(USER_INFO, '$1***@').replace(QUERY_VALUE, '$1***');
}
