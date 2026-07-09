
import {ModelTier} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsIn,IsOptional,IsRFC3339,IsString} from 'class-validator'
import {ApiProperty} from '@nestjs/swagger'




export class UpdateModelHealthDto {
  @IsOptional()
@IsString()
provider?: string;
@IsOptional()
@IsString()
model?: string;
@ApiProperty({
  enum: ModelTier,
})
@IsOptional()
@IsIn(["frontier","verified","experimental"])
tier?: ModelTier;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
@IsOptional()
@IsRFC3339()
quarantinedAt?: Date;
@IsOptional()
@IsString()
quarantineReason?: string;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
@IsOptional()
@IsRFC3339()
lastProbeAt?: Date;
}
