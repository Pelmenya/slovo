
import {Prisma,WaterSourceType,WaterGeocodeSource} from '@prisma/client'
import {ApiProperty} from '@nestjs/swagger'
import {WaterAnalysisRaw} from '../../water-analysis-raw/entities/water-analysis-raw.entity'


export class WaterAnalysis {
  id: string ;
rawId: string ;
raw?: WaterAnalysisRaw ;
orderNumber: string ;
sourceFileName: string ;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
sampleDate: Date ;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
testDate: Date  | null;
@ApiProperty({
  enum: WaterSourceType,
})
intakeType: WaterSourceType ;
appearance: string  | null;
params: Prisma.JsonValue ;
paramUnits: Prisma.JsonValue ;
paramFlags: Prisma.JsonValue ;
paramsUnknown: Prisma.JsonValue ;
canonicalAddress: string  | null;
fiasId: string  | null;
region: string  | null;
district: string  | null;
locality: string  | null;
@ApiProperty({
  type: `number`,
  format: `float`,
})
lat: number  | null;
@ApiProperty({
  type: `number`,
  format: `float`,
})
lon: number  | null;
@ApiProperty({
  enum: WaterGeocodeSource,
})
geoSource: WaterGeocodeSource  | null;
dealerLocation: string  | null;
normalizationVersion: string ;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
normalizedAt: Date ;
}
