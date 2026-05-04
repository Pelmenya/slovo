
import {Prisma} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsInt,IsOptional,IsString} from 'class-validator'
import {ApiProperty} from '@nestjs/swagger'




export class UpdateWaterAnalysisRawDto {
  @IsOptional()
@IsString()
orderNumber?: string;
@IsOptional()
@IsString()
sourceFileName?: string;
@IsOptional()
@IsString()
sourceFileHash?: string;
@IsOptional()
filenameMeta?: Prisma.InputJsonValue;
@IsOptional()
visionPayload?: Prisma.InputJsonValue;
@IsOptional()
@IsString()
visionModel?: string;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
@IsOptional()
@IsInt()
visionTokensIn?: number;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
@IsOptional()
@IsInt()
visionTokensOut?: number;
@IsOptional()
@IsString()
ahunterRawAddress?: string;
@IsOptional()
ahunterRawResponse?: Prisma.InputJsonValue;
@IsOptional()
ahunterDealerResponse?: Prisma.InputJsonValue;
}
