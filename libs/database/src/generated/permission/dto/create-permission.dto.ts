
import {Prisma} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsNotEmpty,IsOptional,IsRFC3339,IsString} from 'class-validator'
import {ApiProperty,getSchemaPath} from '@nestjs/swagger'




export class CreatePermissionDto {
  @IsNotEmpty()
@IsString()
action: string;
@IsNotEmpty()
@IsString()
toolName: string;
@IsNotEmpty()
args: Prisma.InputJsonValue;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
@IsOptional()
@IsRFC3339()
respondedAt?: Date;
@IsOptional()
@IsString()
respondedBy?: string;
@IsOptional()
@IsString()
reason?: string;
}
