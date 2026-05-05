
import {Prisma} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsInt,IsNotEmpty,IsNumber,IsOptional,IsRFC3339,IsString} from 'class-validator'
import {ApiProperty,getSchemaPath} from '@nestjs/swagger'




export class CreateWaterAnalysisRawDto {
  @IsNotEmpty()
@IsString()
orderNumber: string;
@IsNotEmpty()
@IsString()
sourceFileName: string;
@IsOptional()
@IsString()
sourceFileHash?: string;
@IsNotEmpty()
filenameMeta: Prisma.InputJsonValue;
@IsNotEmpty()
visionPayload: Prisma.InputJsonValue;
@IsNotEmpty()
@IsString()
visionModel: string;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
@IsNotEmpty()
@IsInt()
visionTokensIn: number;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
@IsNotEmpty()
@IsInt()
visionTokensOut: number;
@IsOptional()
@IsString()
ahunterRawAddress?: string;
@IsOptional()
ahunterRawResponse?: Prisma.InputJsonValue;
@IsOptional()
ahunterDealerResponse?: Prisma.InputJsonValue;
@IsOptional()
@IsString()
addressPreCleaned?: string;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
@IsOptional()
@IsRFC3339()
addressPreCleanedAt?: Date;
@IsOptional()
ahunterCleansed?: Prisma.InputJsonValue;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
@IsOptional()
@IsRFC3339()
ahunterCleansedAt?: Date;
@IsOptional()
@IsString()
ahunterCleansedTier?: string;
@IsOptional()
@IsString()
ahunterCleansedQuery?: string;
@ApiProperty({
  type: `number`,
  format: `float`,
})
@IsOptional()
@IsNumber()
geoLat?: number;
@ApiProperty({
  type: `number`,
  format: `float`,
})
@IsOptional()
@IsNumber()
geoLon?: number;
@IsOptional()
@IsString()
geoRegion?: string;
@IsOptional()
@IsString()
geoCity?: string;
@IsOptional()
@IsString()
geoPretty?: string;
@IsOptional()
@IsString()
geoLevel?: string;
@IsOptional()
@IsString()
aiVerified?: string;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
@IsOptional()
@IsRFC3339()
aiVerifiedAt?: Date;
@IsOptional()
@IsString()
aiVerifiedNotes?: string;
}
