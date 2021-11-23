import { Gibbon } from '@icazemier/gibbons';

/**
 * Union type representing the accepted input formats for group/permission positions.
 * - `Gibbon` - A Gibbon instance with bit positions already set
 * - `Array<number>` - An array of 1-based position numbers
 * - `Buffer` - A raw buffer representing bitwise positions
 */
export type GibbonLike = Gibbon | Array<number> | Buffer;
