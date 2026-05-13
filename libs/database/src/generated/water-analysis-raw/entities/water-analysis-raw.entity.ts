
import {Prisma,WaterGeoLevel,WaterGeocodeSource,WaterAddressVerification} from '@prisma/client'
import {ApiProperty} from '@nestjs/swagger'
import {WaterAnalysis} from '../../water-analysis/entities/water-analysis.entity'


export class WaterAnalysisRaw {
  id: string ;
orderNumber: string ;
sourceFileName: string ;
sourceFileHash: string  | null;
filenameMeta: Prisma.JsonValue ;
visionPayload: Prisma.JsonValue ;
visionModel: string ;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
visionTokensIn: number ;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
visionTokensOut: number ;
ahunterRawAddress: string  | null;
ahunterRawResponse: Prisma.JsonValue  | null;
ahunterDealerResponse: Prisma.JsonValue  | null;
addressPreCleaned: string  | null;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
addressPreCleanedAt: Date  | null;
ahunterCleansed: Prisma.JsonValue  | null;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
ahunterCleansedAt: Date  | null;
ahunterCleansedTier: string  | null;
ahunterCleansedQuery: string  | null;
@ApiProperty({
  type: `number`,
  format: `float`,
})
geoLat: number  | null;
@ApiProperty({
  type: `number`,
  format: `float`,
})
geoLon: number  | null;
geoRegion: string  | null;
geoCity: string  | null;
geoPretty: string  | null;
@ApiProperty({
  enum: WaterGeoLevel,
})
geoLevel: WaterGeoLevel  | null;
@ApiProperty({
  enum: WaterGeocodeSource,
})
geoSource: WaterGeocodeSource  | null;
@ApiProperty({
  enum: WaterAddressVerification,
})
aiVerified: WaterAddressVerification  | null;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
aiVerifiedAt: Date  | null;
aiVerifiedNotes: string  | null;
extractionEngine: string  | null;
extractionEngineVersion: string  | null;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
extractedAt: Date ;
normalized?: WaterAnalysis  | null;
}
