import { Action, createReducer, on } from '@ngrx/store';
import { addinstructorgridDataSuccess, deleteinstructorgridSuccess, fetchinstructorListData, fetchinstructorListFailure, fetchinstructorListSuccess, fetchinstructorgridData, fetchinstructorgridFailure, fetchinstructorgridSuccess, updateinstructorgridDataSuccess } from './instructor.action';
import { deleteOrderSuccess } from '../Orders/order.action';

export interface InstructorState {
    instructorlist: any[];
    instructorGrid: any[];
    loading: boolean;
    error: any;
}

export const initialState: InstructorState = {
    instructorlist: [],
    instructorGrid: [],
    loading: false,
    error: null
};

export const InstructorReducer = createReducer(

    initialState,
    on(fetchinstructorListData, (state) => {
        return { ...state, loading: true, error: null };
    }),
    on(fetchinstructorListSuccess, (state, { instructorlist }) => {
        return { ...state, instructorlist, loading: false };
    }),
    on(fetchinstructorListFailure, (state, { error }) => {
        return { ...state, error, loading: false };
    }),

    on(fetchinstructorgridData, (state) => {
        return { ...state, loading: true, error: null };
    }),
    on(fetchinstructorgridSuccess, (state, { instructorGrid }) => {
        return { ...state, instructorGrid, loading: false };
    }),
    on(fetchinstructorgridFailure, (state, { error }) => {
        return { ...state, error, loading: false };
    }),

    on(addinstructorgridDataSuccess, (state, { newData }) => {
        return { ...state, instructorGrid: [newData, ...state.instructorGrid], error: null };

    }),
    on(updateinstructorgridDataSuccess, (state, { updatedData }) => {
        return { ...state, instructorGrid: state.instructorGrid.map((instructorGrid) => instructorGrid.id === updatedData.id ? updatedData : instructorGrid), error: null };
    }),

    on(deleteinstructorgridSuccess, (state, { id }) => {
        const updatedlist = state.instructorGrid.filter((instructorGrid) => !id.includes(instructorGrid.id));
        return { ...state, instructorgrid: updatedlist, error: null };
    }),

)

// Selector
export function reducer(state: InstructorState | undefined, action: Action) {
    return InstructorReducer(state, action);
}