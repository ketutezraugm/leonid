import { z } from 'zod';
import { VenueTerms } from '@leonid/shared';

// One demo venue in data/venues.json. Kept apart from the catalog so the generator script can
// validate rows without importing the file it is about to write.
export const VenueListing = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  country: z.enum(['id', 'my', 'sg']),
  city: z.string().min(1),
  area: z.string().min(1),
  type: z.enum([
    'hotel_ballroom',
    'meeting_room',
    'coworking',
    'auditorium',
    'rooftop',
    'restaurant',
    'convention_hall',
  ]),
  capacity: z.number().int().positive().nullable(),
  price: z.object({
    // Minor units: whole rupiah for IDR, sen for MYR, cents for SGD.
    amountMinor: z.number().int().positive(),
    currency: z.enum(['IDR', 'MYR', 'SGD']),
    per: z.enum(['pax', 'package', 'hour', 'day']),
  }),
  // How the price works: minimums, what it covers and what costs extra.
  terms: VenueTerms,
  // The deposit that holds the date, paid with PayPal. Always USD: PayPal cannot charge IDR, and
  // takes MYR only between Malaysian accounts, so the event budget's currency is used instead.
  deposit: z.object({
    amountMinor: z.number().int().positive(),
    currency: z.literal('USD'),
  }),
  catering: z.enum(['yes', 'no', 'unknown']),
  booking: z.enum(['whatsapp', 'phone', 'website']),
  amenities: z.array(z.string()).max(8),
  description: z.string().max(500),
});
export type VenueListing = z.infer<typeof VenueListing>;
