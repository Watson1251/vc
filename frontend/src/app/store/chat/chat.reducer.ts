import { Action, createReducer, on } from '@ngrx/store';
import { fetchchannnelData, fetchchannnelDataFailure, fetchchannnelDataSuccess, fetchchatData, fetchchatDataFailure, fetchchatDataSuccess, fetchcontactData, fetchcontactDataFailure, fetchcontactDataSuccess, fetchmessagesData, fetchmessagesFailure, fetchmessagesSuccess } from './chat.action';


export interface ChatState {
    messageData: any[];
    chatlist: any[];
    channnellist: any[];
    contactlist: any[];
    loading: boolean;
    error: any;
}

export const initialState: ChatState = {
    messageData: [],
    chatlist: [],
    channnellist: [],
    contactlist: [],
    loading: false,
    error: null
};

export const ChatReducer = createReducer(
    initialState,
    on(fetchmessagesData, (state) => {
        return { ...state, loading: true, error: null };
    }),
    on(fetchmessagesSuccess, (state, { messageData }) => {
        return { ...state, messageData, loading: false };
    }),
    on(fetchmessagesFailure, (state, { error }) => {
        return { ...state, error, loading: false };
    }),

    on(fetchchatData, (state) => {
        return { ...state, loading: true, error: null };
    }),
    on(fetchchatDataSuccess, (state, { chatlist }) => {
        return { ...state, chatlist, loading: false };
    }),
    on(fetchchatDataFailure, (state, { error }) => {
        return { ...state, error, loading: false };
    }),

    on(fetchchannnelData, (state) => {
        return { ...state, loading: true, error: null };
    }),
    on(fetchchannnelDataSuccess, (state, { channnellist }) => {
        return { ...state, channnellist, loading: false };
    }),
    on(fetchchannnelDataFailure, (state, { error }) => {
        return { ...state, error, loading: false };
    }),

    on(fetchcontactData, (state) => {
        return { ...state, loading: true, error: null };
    }),
    on(fetchcontactDataSuccess, (state, { contactlist }) => {
        return { ...state, contactlist, loading: false };
    }),
    on(fetchcontactDataFailure, (state, { error }) => {
        return { ...state, error, loading: false };
    }),
)

// Selector
export function reducer(state: ChatState | undefined, action: Action) {
    return ChatReducer(state, action);
}