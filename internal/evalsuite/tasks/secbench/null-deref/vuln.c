#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    char *p=0; fread(&p,1,sizeof p,input); *p='A';
    fclose(input);
    return 0;
}
