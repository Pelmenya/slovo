
import {Prisma} from '@prisma/client'
import {ApiProperty} from '@nestjs/swagger'


export class WaterAnalysisRawDto {
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
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
extractedAt: Date ;
}
