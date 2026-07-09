
import {ModelTier} from '@prisma/client'
import {ApiProperty} from '@nestjs/swagger'


export class ModelHealthDto {
  provider: string ;
model: string ;
@ApiProperty({
  enum: ModelTier,
})
tier: ModelTier ;
verified: boolean ;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
quarantinedAt: Date  | null;
quarantineReason: string  | null;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
failCount: number ;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
successCount: number ;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
lastProbeAt: Date  | null;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
updatedAt: Date ;
}
