#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    size_t n=0; fread(&n,sizeof n,1,input); char *p=malloc(n); fread(p,1,8,input);
    fclose(input);
    return 0;
}
