
import {Prisma,WaterSourceType,GeocodeSource} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsIn,IsNumber,IsOptional,IsRFC3339,IsString} from 'class-validator'
import {ApiProperty} from '@nestjs/swagger'




export class UpdateWaterAnalysisDto {
  @IsOptional()
@IsString()
orderNumber?: string;
@IsOptional()
@IsString()
sourceFileName?: string;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
@IsOptional()
@IsRFC3339()
sampleDate?: Date;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
@IsOptional()
@IsRFC3339()
testDate?: Date;
@ApiProperty({
  enum: WaterSourceType,
})
@IsOptional()
@IsIn(["well","well_dug","municipal","spring","river","other"])
intakeType?: WaterSourceType;
@IsOptional()
@IsString()
appearance?: string;
@IsOptional()
params?: Prisma.InputJsonValue;
@IsOptional()
@IsString()
canonicalAddress?: string;
@IsOptional()
@IsString()
fiasId?: string;
@IsOptional()
@IsString()
region?: string;
@IsOptional()
@IsString()
district?: string;
@IsOptional()
@IsString()
locality?: string;
@ApiProperty({
  type: `number`,
  format: `float`,
})
@IsOptional()
@IsNumber()
lat?: number;
@ApiProperty({
  type: `number`,
  format: `float`,
})
@IsOptional()
@IsNumber()
lon?: number;
@ApiProperty({
  enum: GeocodeSource,
})
@IsOptional()
@IsIn(["blank","dealer_fallback","none"])
geocodeSource?: GeocodeSource;
@IsOptional()
@IsString()
dealerLocation?: string;
@IsOptional()
@IsString()
customerNameRef?: string;
@IsOptional()
@IsString()
normalizationVersion?: string;
}
