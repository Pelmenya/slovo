
import {Prisma} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsInt,IsNotEmpty,IsOptional,IsString} from 'class-validator'
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
}
