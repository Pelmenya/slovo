
import {Type} from 'class-transformer'
import {IsOptional,IsString} from 'class-validator'




export class CreateAgentSessionDto {
  @IsOptional()
@IsString()
userId?: string;
@IsOptional()
@IsString()
title?: string;
}
