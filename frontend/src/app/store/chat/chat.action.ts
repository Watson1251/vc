import { createAction, props } from '@ngrx/store';
import { ChannelModel, ChatMessage, ContactModel, Message } from './chat.model';

export const fetchmessagesData = createAction('[Data] Fetch messages Data');
export const fetchmessagesSuccess = createAction('[Data] Fetch messages Data Success', props<{ messageData: Message[] }>());
export const fetchmessagesFailure = createAction('[Data] Fetch messages Data Failure', props<{ error: string }>());

export const fetchchatData = createAction('[Data] Fetch chatData Data');
export const fetchchatDataSuccess = createAction('[Data] Fetch chatData Data Success', props<{ chatlist: ChatMessage[] }>());
export const fetchchatDataFailure = createAction('[Data] Fetch chatData Data Failure', props<{ error: string }>());

export const fetchchannnelData = createAction('[Data] Fetch channnelData Data');
export const fetchchannnelDataSuccess = createAction('[Data] Fetch channnelData Data Success', props<{ channnellist: ChannelModel[] }>());
export const fetchchannnelDataFailure = createAction('[Data] Fetch channnelData Data Failure', props<{ error: string }>());

export const fetchcontactData = createAction('[Data] Fetch contactData Data');
export const fetchcontactDataSuccess = createAction('[Data] Fetch contactData Data Success', props<{ contactlist: ContactModel[] }>());
export const fetchcontactDataFailure = createAction('[Data] Fetch contactData Data Failure', props<{ error: string }>());