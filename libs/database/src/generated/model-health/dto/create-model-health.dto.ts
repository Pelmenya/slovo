
import {ModelTier} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsIn,IsNotEmpty,IsOptional,IsRFC3339,IsString} from 'class-validator'
import {ApiProperty,getSchemaPath} from '@nestjs/swagger'




export class CreateModelHealthDto {
  @IsNotEmpty()
@IsString()
provider: string;
@IsNotEmpty()
@IsString()
model: string;
@ApiProperty({
  enum: ModelTier,
})
@IsNotEmpty()
@IsIn(["frontier","verified","experimental"])
tier: ModelTier;
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
