
import {Prisma,WaterSourceType,WaterGeocodeSource} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsIn,IsNotEmpty,IsNumber,IsOptional,IsRFC3339,IsString} from 'class-validator'
import {ApiProperty,getSchemaPath} from '@nestjs/swagger'




export class CreateWaterAnalysisDto {
  @IsNotEmpty()
@IsString()
orderNumber: string;
@IsNotEmpty()
@IsString()
sourceFileName: string;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
@IsNotEmpty()
@IsRFC3339()
sampleDate: Date;
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
@IsNotEmpty()
@IsIn(["well","well_dug","municipal","spring","river","other"])
intakeType: WaterSourceType;
@IsOptional()
@IsString()
appearance?: string;
@IsNotEmpty()
params: Prisma.InputJsonValue;
@IsNotEmpty()
paramUnits: Prisma.InputJsonValue;
@IsNotEmpty()
paramFlags: Prisma.InputJsonValue;
@IsNotEmpty()
paramsUnknown: Prisma.InputJsonValue;
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
  enum: WaterGeocodeSource,
})
@IsOptional()
@IsIn(["ahunter_cleanse","dealer_median","manual_override"])
geoSource?: WaterGeocodeSource;
@IsOptional()
@IsString()
dealerLocation?: string;
@ApiProperty({
  type: `number`,
  format: `float`,
})
@IsOptional()
@IsNumber()
depthMeters?: number;
@IsOptional()
@IsString()
labName?: string;
@IsOptional()
@IsString()
embeddingText?: string;
@IsOptional()
@IsString()
intakeSource?: string;
@ApiProperty({
  type: `number`,
  format: `float`,
})
@IsOptional()
@IsNumber()
canonicalLat?: number;
@ApiProperty({
  type: `number`,
  format: `float`,
})
@IsOptional()
@IsNumber()
canonicalLon?: number;
@IsOptional()
@IsString()
canonicalFiasId?: string;
@IsOptional()
@IsString()
canonicalAddressNew?: string;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
@IsOptional()
@IsRFC3339()
regeocodedAt?: Date;
@IsOptional()
paramsCanonical?: Prisma.InputJsonValue;
@IsOptional()
@IsString()
embeddingTextCanonical?: string;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
@IsOptional()
@IsRFC3339()
reembeddedAt?: Date;
@IsNotEmpty()
@IsString()
normalizationVersion: string;
}
