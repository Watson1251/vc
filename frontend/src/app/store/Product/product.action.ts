import { createAction, props } from '@ngrx/store';
import { productModel } from './product.model';

export const fetchproductsData = createAction('[Data] Fetch products Data');
export const fetchproductsSuccess = createAction('[Data] Fetch products Data Success', props<{ productlist: productModel[] }>());
export const fetchproductsFailure = createAction('[Data] Fetch products Data Failure', props<{ error: string }>());

// Add Data
export const addproductsData = createAction(
    '[Data] Add productsData',
    props<{ newData: productModel }>()
);
export const addproductsDataSuccess = createAction(
    '[Data] Add productsData Success',
    props<{ newData: productModel }>()
);
export const addproductsDataFailure = createAction(
    '[Data] Add productsData Failure',
    props<{ error: string }>()
);


// Update Data
export const updateproductsData = createAction(
    '[Data] Update productsData',
    props<{ updatedData: productModel }>()
);
export const updateproductsDataSuccess = createAction(
    '[Data] Update productsData Success',
    props<{ updatedData: productModel }>()
);
export const updateproductsDataFailure = createAction(
    '[Data] Update productsData Failure',
    props<{ error: string }>()
);

// Delete Data
export const deleteproductsData = createAction(
    '[Data] Delete productsData',
    props<{ id: string }>()
);
export const deleteproductsSuccess = createAction(
    '[Data] Delete productsData Success',
    props<{ id: string }>()
);
export const deleteproductsFailure = createAction(
    '[Data] Delete productsData Failure',
    props<{ error: string }>()
);